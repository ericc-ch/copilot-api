use std::sync::Arc;

use axum::{
    extract::State,
    response::{sse::Sse, IntoResponse, Response},
    Json,
};
use tracing::{debug, error};

use crate::copilot::copilot_headers;
use crate::error::AppError;
use crate::state::AppState;
use crate::translate::{
    request::{translate_to_openai, AnthropicRequest},
    response::{translate_non_streaming, translate_stream, OpenAIResponse},
};

pub async fn handle_messages(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AnthropicRequest>,
) -> Result<Response, AppError> {
    debug!("Received Anthropic request for model: {}", payload.model);
    
    // Track request
    state.stats.inc_requests();

    // Check rate limit
    state.check_rate_limit().await;

    // Get Copilot token
    let token = state
        .get_copilot_token()
        .await
        .ok_or_else(|| {
            state.stats.inc_errors();
            AppError::NoToken
        })?;

    // Translate request
    let openai_payload = translate_to_openai(&payload);
    debug!("Translated to OpenAI format");

    // Check for vision content
    let has_vision = payload.messages.iter().any(|m| {
        m.content.iter().any(|c| matches!(c, crate::translate::request::ContentBlock::Image { .. }))
    });

    // Make request to Copilot
    let url = format!("{}/chat/completions", state.copilot_base_url());
    let headers = copilot_headers(&token, has_vision);

    let is_streaming = payload.stream.unwrap_or(false);

    if is_streaming {
        // Streaming response
        let response = state
            .http_client
            .post(&url)
            .headers(headers)
            .json(&openai_payload)
            .send()
            .await
            .map_err(|e| {
                state.stats.inc_errors();
                e
            })?;

        if !response.status().is_success() {
            state.stats.inc_errors();
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("Copilot API error: {} - {}", status, body);
            return Err(AppError::CopilotError(format!("{}: {}", status, body)));
        }

        let byte_stream = response.bytes_stream();
        let anthropic_stream = translate_stream(byte_stream, payload.model.clone());

        Ok(Sse::new(anthropic_stream)
            .keep_alive(axum::response::sse::KeepAlive::default())
            .into_response())
    } else {
        // Non-streaming response
        let response = state
            .http_client
            .post(&url)
            .headers(headers)
            .json(&openai_payload)
            .send()
            .await
            .map_err(|e| {
                state.stats.inc_errors();
                e
            })?;

        if !response.status().is_success() {
            state.stats.inc_errors();
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("Copilot API error: {} - {}", status, body);
            return Err(AppError::CopilotError(format!("{}: {}", status, body)));
        }

        let openai_response: OpenAIResponse = response.json().await?;
        let anthropic_response = translate_non_streaming(openai_response, &payload.model);

        Ok(Json(anthropic_response).into_response())
    }
}
