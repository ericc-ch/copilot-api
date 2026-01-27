use std::convert::Infallible;

use axum::response::sse::Event;
use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// OpenAI non-streaming response
#[derive(Debug, Deserialize)]
pub struct OpenAIResponse {
    pub id: String,
    pub choices: Vec<OpenAIChoice>,
    pub usage: Option<OpenAIUsage>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIChoice {
    pub message: OpenAIResponseMessage,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIResponseMessage {
    pub role: String,
    pub content: Option<String>,
    pub tool_calls: Option<Vec<OpenAIResponseToolCall>>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIResponseToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: OpenAIResponseFunction,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIResponseFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// OpenAI streaming chunk
#[derive(Debug, Deserialize)]
pub struct OpenAIChunk {
    pub id: String,
    pub choices: Vec<OpenAIChunkChoice>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIChunkChoice {
    pub delta: OpenAIDelta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIDelta {
    pub content: Option<String>,
    pub tool_calls: Option<Vec<OpenAIDeltaToolCall>>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIDeltaToolCall {
    pub index: usize,
    pub id: Option<String>,
    pub function: Option<OpenAIDeltaFunction>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIDeltaFunction {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

/// Anthropic response types
#[derive(Debug, Serialize)]
pub struct AnthropicResponse {
    pub id: String,
    #[serde(rename = "type")]
    pub response_type: String,
    pub role: String,
    pub content: Vec<AnthropicContentBlock>,
    pub model: String,
    pub stop_reason: Option<String>,
    pub usage: AnthropicUsage,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AnthropicContentBlock {
    Text { text: String },
    ToolUse { id: String, name: String, input: Value },
}

#[derive(Debug, Serialize)]
pub struct AnthropicUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// Translate non-streaming OpenAI response to Anthropic format
pub fn translate_non_streaming(resp: OpenAIResponse, model: &str) -> AnthropicResponse {
    let choice = resp.choices.into_iter().next().unwrap_or(OpenAIChoice {
        message: OpenAIResponseMessage {
            role: "assistant".to_string(),
            content: None,
            tool_calls: None,
        },
        finish_reason: Some("stop".to_string()),
    });

    let mut content = Vec::new();

    // Add text content
    if let Some(text) = choice.message.content {
        if !text.is_empty() {
            content.push(AnthropicContentBlock::Text { text });
        }
    }

    // Add tool uses
    if let Some(tool_calls) = choice.message.tool_calls {
        for tc in tool_calls {
            let input: Value = serde_json::from_str(&tc.function.arguments)
                .unwrap_or(json!({}));
            content.push(AnthropicContentBlock::ToolUse {
                id: tc.id,
                name: tc.function.name,
                input,
            });
        }
    }

    let stop_reason = match choice.finish_reason.as_deref() {
        Some("stop") => Some("end_turn".to_string()),
        Some("length") => Some("max_tokens".to_string()),
        Some("tool_calls") => Some("tool_use".to_string()),
        other => other.map(|s| s.to_string()),
    };

    let usage = resp.usage.map(|u| AnthropicUsage {
        input_tokens: u.prompt_tokens,
        output_tokens: u.completion_tokens,
    }).unwrap_or(AnthropicUsage {
        input_tokens: 0,
        output_tokens: 0,
    });

    AnthropicResponse {
        id: format!("msg_{}", resp.id),
        response_type: "message".to_string(),
        role: "assistant".to_string(),
        content,
        model: model.to_string(),
        stop_reason,
        usage,
    }
}

/// State for tracking streaming translation
#[derive(Default)]
struct StreamState {
    message_started: bool,
    content_block_index: usize,
    content_block_open: bool,
    tool_calls: std::collections::HashMap<usize, ToolCallState>,
    message_id: String,
    model: String,
}

#[derive(Default)]
struct ToolCallState {
    id: String,
    name: String,
    arguments: String,
    started: bool,
}

/// Translate streaming OpenAI response to Anthropic SSE events
pub fn translate_stream<S>(
    byte_stream: S,
    model: String,
) -> impl Stream<Item = Result<Event, Infallible>>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    async_stream::stream! {
        let mut state = StreamState {
            model,
            ..Default::default()
        };
        let mut buffer = String::new();
        let mut stream_done = false;

        let mut stream = Box::pin(byte_stream);

        while let Some(chunk_result) = stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("Stream error: {}", e);
                    break;
                }
            };

            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            // Process complete SSE lines
            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim_end().to_string();
                buffer.drain(..=line_end);

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }

                if line.starts_with("data: ") {
                    let data = &line[6..];
                    
                    if data == "[DONE]" {
                        stream_done = true;
                        // Close any open content block
                        if state.content_block_open {
                            yield Ok(make_event("content_block_stop", json!({
                                "type": "content_block_stop",
                                "index": state.content_block_index
                            })));
                            state.content_block_open = false;
                        }

                        // Send message_delta with stop reason
                        yield Ok(make_event("message_delta", json!({
                            "type": "message_delta",
                            "delta": { "stop_reason": "end_turn", "stop_sequence": null },
                            "usage": { "output_tokens": 0 }
                        })));

                        // Send message_stop
                        yield Ok(make_event("message_stop", json!({
                            "type": "message_stop"
                        })));
                        break;
                    }

                    if let Ok(chunk) = serde_json::from_str::<OpenAIChunk>(data) {
                        for event in process_chunk(&chunk, &mut state) {
                            yield Ok(event);
                        }
                    }
                }
            }
            
            if stream_done {
                break;
            }
        }

        // Handle any remaining data in buffer after stream ends (edge case)
        if !stream_done && !buffer.is_empty() {
            let line = buffer.trim();
            if line.starts_with("data: ") {
                let data = &line[6..];
                if data != "[DONE]" {
                    if let Ok(chunk) = serde_json::from_str::<OpenAIChunk>(data) {
                        for event in process_chunk(&chunk, &mut state) {
                            yield Ok(event);
                        }
                    }
                }
            }
        }

        // Ensure we send closing events if stream ended unexpectedly
        if !stream_done && state.message_started {
            if state.content_block_open {
                yield Ok(make_event("content_block_stop", json!({
                    "type": "content_block_stop",
                    "index": state.content_block_index
                })));
            }
            yield Ok(make_event("message_delta", json!({
                "type": "message_delta",
                "delta": { "stop_reason": "end_turn", "stop_sequence": null },
                "usage": { "output_tokens": 0 }
            })));
            yield Ok(make_event("message_stop", json!({
                "type": "message_stop"
            })));
        }
    }
}

fn process_chunk(chunk: &OpenAIChunk, state: &mut StreamState) -> Vec<Event> {
    let mut events = Vec::new();

    // Send message_start on first chunk
    if !state.message_started {
        state.message_id = format!("msg_{}", chunk.id);
        events.push(make_event("message_start", json!({
            "type": "message_start",
            "message": {
                "id": state.message_id,
                "type": "message",
                "role": "assistant",
                "content": [],
                "model": state.model,
                "stop_reason": null,
                "stop_sequence": null,
                "usage": { "input_tokens": 0, "output_tokens": 0 }
            }
        })));
        state.message_started = true;
    }

    for choice in &chunk.choices {
        // Handle text content
        if let Some(content) = &choice.delta.content {
            if !content.is_empty() {
                // Start content block if needed
                if !state.content_block_open {
                    events.push(make_event("content_block_start", json!({
                        "type": "content_block_start",
                        "index": state.content_block_index,
                        "content_block": { "type": "text", "text": "" }
                    })));
                    state.content_block_open = true;
                }

                events.push(make_event("content_block_delta", json!({
                    "type": "content_block_delta",
                    "index": state.content_block_index,
                    "delta": { "type": "text_delta", "text": content }
                })));
            }
        }

        // Handle tool calls
        if let Some(tool_calls) = &choice.delta.tool_calls {
            for tc in tool_calls {
                let tool_state = state.tool_calls.entry(tc.index).or_default();

                // Accumulate tool call data
                if let Some(id) = &tc.id {
                    tool_state.id = id.clone();
                }
                if let Some(func) = &tc.function {
                    if let Some(name) = &func.name {
                        tool_state.name = name.clone();
                    }
                    if let Some(args) = &func.arguments {
                        tool_state.arguments.push_str(args);
                    }
                }

                // Start tool use block if we have the id and name
                if !tool_state.started && !tool_state.id.is_empty() && !tool_state.name.is_empty() {
                    // Close text block if open
                    if state.content_block_open {
                        events.push(make_event("content_block_stop", json!({
                            "type": "content_block_stop",
                            "index": state.content_block_index
                        })));
                        state.content_block_index += 1;
                        state.content_block_open = false;
                    }

                    events.push(make_event("content_block_start", json!({
                        "type": "content_block_start",
                        "index": state.content_block_index,
                        "content_block": {
                            "type": "tool_use",
                            "id": tool_state.id,
                            "name": tool_state.name,
                            "input": {}
                        }
                    })));
                    tool_state.started = true;
                    state.content_block_open = true;
                }

                // Stream argument deltas
                if tool_state.started {
                    if let Some(func) = &tc.function {
                        if let Some(args) = &func.arguments {
                            if !args.is_empty() {
                                events.push(make_event("content_block_delta", json!({
                                    "type": "content_block_delta",
                                    "index": state.content_block_index,
                                    "delta": {
                                        "type": "input_json_delta",
                                        "partial_json": args
                                    }
                                })));
                            }
                        }
                    }
                }
            }
        }

        // Handle finish reason
        if let Some(reason) = &choice.finish_reason {
            // Close any open content block
            if state.content_block_open {
                events.push(make_event("content_block_stop", json!({
                    "type": "content_block_stop",
                    "index": state.content_block_index
                })));
                state.content_block_open = false;
            }

            let stop_reason = match reason.as_str() {
                "stop" => "end_turn",
                "length" => "max_tokens",
                "tool_calls" => "tool_use",
                _ => reason.as_str(),
            };

            events.push(make_event("message_delta", json!({
                "type": "message_delta",
                "delta": { "stop_reason": stop_reason, "stop_sequence": null },
                "usage": { "output_tokens": 0 }
            })));

            events.push(make_event("message_stop", json!({
                "type": "message_stop"
            })));
        }
    }

    events
}

fn make_event(event_type: &str, data: Value) -> Event {
    Event::default()
        .event(event_type)
        .data(serde_json::to_string(&data).unwrap_or_default())
}
