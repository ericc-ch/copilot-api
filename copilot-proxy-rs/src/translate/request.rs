use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Anthropic Messages API request format
#[derive(Debug, Deserialize)]
pub struct AnthropicRequest {
    pub model: String,
    pub messages: Vec<AnthropicMessage>,
    #[serde(default)]
    pub system: Option<String>,
    pub max_tokens: u32,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub top_p: Option<f32>,
    #[serde(default)]
    pub stream: Option<bool>,
    #[serde(default)]
    pub stop_sequences: Option<Vec<String>>,
    #[serde(default)]
    pub tools: Option<Vec<AnthropicTool>>,
    #[serde(default)]
    pub tool_choice: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct AnthropicMessage {
    pub role: String,
    #[serde(deserialize_with = "deserialize_content")]
    pub content: Vec<ContentBlock>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text { text: String },
    Image { source: ImageSource },
    ToolUse { id: String, name: String, input: Value },
    ToolResult { tool_use_id: String, content: String },
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct AnthropicTool {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub input_schema: Value,
}

/// Custom deserializer to handle both string and array content
fn deserialize_content<'de, D>(deserializer: D) -> Result<Vec<ContentBlock>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum ContentOrString {
        String(String),
        Blocks(Vec<ContentBlock>),
    }

    match ContentOrString::deserialize(deserializer)? {
        ContentOrString::String(s) => Ok(vec![ContentBlock::Text { text: s }]),
        ContentOrString::Blocks(blocks) => Ok(blocks),
    }
}

/// OpenAI Chat Completions request format
#[derive(Debug, Serialize)]
pub struct OpenAIRequest {
    pub model: String,
    pub messages: Vec<OpenAIMessage>,
    pub max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<OpenAITool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct OpenAIMessage {
    pub role: String,
    pub content: OpenAIContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<OpenAIToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum OpenAIContent {
    Text(String),
    Parts(Vec<OpenAIContentPart>),
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OpenAIContentPart {
    Text { text: String },
    ImageUrl { image_url: ImageUrl },
}

#[derive(Debug, Serialize)]
pub struct ImageUrl {
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct OpenAIToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: OpenAIFunctionCall,
}

#[derive(Debug, Serialize)]
pub struct OpenAIFunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Serialize)]
pub struct OpenAITool {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: OpenAIFunction,
}

#[derive(Debug, Serialize)]
pub struct OpenAIFunction {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub parameters: Value,
}

/// Translate Anthropic request to OpenAI format
pub fn translate_to_openai(req: &AnthropicRequest) -> OpenAIRequest {
    let mut messages = Vec::new();

    // Add system message if present
    if let Some(system) = &req.system {
        messages.push(OpenAIMessage {
            role: "system".to_string(),
            content: OpenAIContent::Text(system.clone()),
            tool_calls: None,
            tool_call_id: None,
        });
    }

    // Translate messages
    for msg in &req.messages {
        let openai_msg = translate_message(msg);
        messages.extend(openai_msg);
    }

    // Translate tools
    let tools = req.tools.as_ref().map(|tools| {
        tools
            .iter()
            .map(|t| OpenAITool {
                tool_type: "function".to_string(),
                function: OpenAIFunction {
                    name: t.name.clone(),
                    description: t.description.clone(),
                    parameters: t.input_schema.clone(),
                },
            })
            .collect()
    });

    OpenAIRequest {
        model: req.model.clone(),
        messages,
        max_tokens: req.max_tokens,
        temperature: req.temperature,
        top_p: req.top_p,
        stream: req.stream.unwrap_or(false),
        stop: req.stop_sequences.clone(),
        tools,
        tool_choice: req.tool_choice.clone(),
    }
}

fn translate_message(msg: &AnthropicMessage) -> Vec<OpenAIMessage> {
    let mut result = Vec::new();

    // Handle tool results specially - they become separate "tool" role messages
    let tool_results: Vec<_> = msg.content.iter()
        .filter_map(|c| match c {
            ContentBlock::ToolResult { tool_use_id, content } => Some((tool_use_id, content)),
            _ => None,
        })
        .collect();

    for (tool_use_id, content) in tool_results {
        result.push(OpenAIMessage {
            role: "tool".to_string(),
            content: OpenAIContent::Text(content.clone()),
            tool_calls: None,
            tool_call_id: Some(tool_use_id.clone()),
        });
    }

    // Handle other content
    let other_content: Vec<_> = msg.content.iter()
        .filter(|c| !matches!(c, ContentBlock::ToolResult { .. }))
        .collect();

    if other_content.is_empty() {
        return result;
    }

    // Check for tool uses (assistant with tool calls)
    let tool_uses: Vec<_> = other_content.iter()
        .filter_map(|c| match c {
            ContentBlock::ToolUse { id, name, input } => Some((id, name, input)),
            _ => None,
        })
        .collect();

    if !tool_uses.is_empty() && msg.role == "assistant" {
        // Get text content if any
        let text_content: String = other_content.iter()
            .filter_map(|c| match c {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        let tool_calls: Vec<OpenAIToolCall> = tool_uses.iter()
            .map(|(id, name, input)| OpenAIToolCall {
                id: (*id).clone(),
                call_type: "function".to_string(),
                function: OpenAIFunctionCall {
                    name: (*name).clone(),
                    arguments: serde_json::to_string(input).unwrap_or_default(),
                },
            })
            .collect();

        result.push(OpenAIMessage {
            role: "assistant".to_string(),
            content: OpenAIContent::Text(text_content),
            tool_calls: Some(tool_calls),
            tool_call_id: None,
        });
    } else {
        // Regular message with text/images
        let has_images = other_content.iter().any(|c| matches!(c, ContentBlock::Image { .. }));

        let content = if has_images {
            let parts: Vec<OpenAIContentPart> = other_content.iter()
                .filter_map(|c| match c {
                    ContentBlock::Text { text } => Some(OpenAIContentPart::Text { text: text.clone() }),
                    ContentBlock::Image { source } => Some(OpenAIContentPart::ImageUrl {
                        image_url: ImageUrl {
                            url: format!("data:{};base64,{}", source.media_type, source.data),
                        },
                    }),
                    _ => None,
                })
                .collect();
            OpenAIContent::Parts(parts)
        } else {
            let text: String = other_content.iter()
                .filter_map(|c| match c {
                    ContentBlock::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("");
            OpenAIContent::Text(text)
        };

        result.push(OpenAIMessage {
            role: msg.role.clone(),
            content,
            tool_calls: None,
            tool_call_id: None,
        });
    }

    result
}
