use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;
use tracing::error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("No Copilot token available")]
    NoToken,

    #[error("Rate limit exceeded")]
    RateLimited,

    #[error("Authentication failed: {0}")]
    AuthError(String),

    #[error("Copilot API error: {0}")]
    CopilotError(String),

    #[error("Request error: {0}")]
    RequestError(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error_type, message) = match &self {
            AppError::NoToken => {
                error!("Request failed: no Copilot token available");
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "authentication_error",
                    self.to_string(),
                )
            }
            AppError::RateLimited => {
                // Don't log rate limits as errors, they're expected
                tracing::warn!("Rate limit applied");
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    "rate_limit_error",
                    self.to_string(),
                )
            }
            AppError::AuthError(msg) => {
                error!("Authentication error: {}", msg);
                (
                    StatusCode::UNAUTHORIZED,
                    "authentication_error",
                    self.to_string(),
                )
            }
            AppError::CopilotError(msg) => {
                error!("Copilot API error: {}", msg);
                (
                    StatusCode::BAD_GATEWAY,
                    "api_error",
                    self.to_string(),
                )
            }
            AppError::RequestError(e) => {
                error!("HTTP request error: {}", e);
                (
                    StatusCode::BAD_GATEWAY,
                    "api_error",
                    self.to_string(),
                )
            }
            AppError::JsonError(e) => {
                error!("JSON parsing error: {}", e);
                (
                    StatusCode::BAD_REQUEST,
                    "invalid_request_error",
                    self.to_string(),
                )
            }
            AppError::IoError(e) => {
                error!("IO error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    self.to_string(),
                )
            }
            AppError::Internal(msg) => {
                error!("Internal error: {}", msg);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    self.to_string(),
                )
            }
        };

        // Return Anthropic-style error format
        let body = json!({
            "type": "error",
            "error": {
                "type": error_type,
                "message": message
            }
        });

        (status, Json(body)).into_response()
    }
}
