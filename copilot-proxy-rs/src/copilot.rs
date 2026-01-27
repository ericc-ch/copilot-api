use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tracing::{debug, error};

use crate::state::AppState;

const GITHUB_API_URL: &str = "https://api.github.com";
const COPILOT_VERSION: &str = "0.26.7";
const USER_AGENT: &str = "GitHubCopilotChat/0.26.7";

#[derive(Deserialize)]
struct CopilotTokenResponse {
    token: String,
    expires_at: i64,
    refresh_in: i64,
}

pub async fn fetch_copilot_token(state: &AppState) -> anyhow::Result<(String, i64)> {
    let resp = state
        .http_client
        .get(format!("{}/copilot_internal/v2/token", GITHUB_API_URL))
        .header("Authorization", format!("token {}", state.github_token))
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .header("Editor-Version", format!("vscode/1.95.0"))
        .header("Editor-Plugin-Version", format!("copilot-chat/{}", COPILOT_VERSION))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Failed to get Copilot token: {} - {}", status, body);
    }

    let token_resp: CopilotTokenResponse = resp.json().await?;
    Ok((token_resp.token, token_resp.refresh_in))
}

pub async fn token_refresh_loop(state: Arc<AppState>) {
    loop {
        match fetch_copilot_token(&state).await {
            Ok((token, refresh_in)) => {
                debug!("Copilot token refreshed, next refresh in {}s", refresh_in);
                state.set_copilot_token(token, refresh_in).await;
                
                // Sleep until it's time to refresh (with some buffer)
                let sleep_secs = (refresh_in as u64).saturating_sub(30).max(60);
                tokio::time::sleep(Duration::from_secs(sleep_secs)).await;
            }
            Err(e) => {
                error!("Failed to refresh Copilot token: {}", e);
                // Retry after a short delay
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        }
    }
}

/// Build headers for Copilot API requests
pub fn copilot_headers(token: &str, enable_vision: bool) -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderValue};
    
    let mut headers = HeaderMap::new();
    
    // Use expect with context for headers that should never fail
    if let Ok(auth_value) = HeaderValue::from_str(&format!("Bearer {}", token)) {
        headers.insert("Authorization", auth_value);
    } else {
        // Fallback: sanitize token by removing invalid characters
        let sanitized: String = token.chars().filter(|c| c.is_ascii_graphic()).collect();
        if let Ok(auth_value) = HeaderValue::from_str(&format!("Bearer {}", sanitized)) {
            headers.insert("Authorization", auth_value);
        }
    }
    
    headers.insert("Content-Type", HeaderValue::from_static("application/json"));
    headers.insert("Accept", HeaderValue::from_static("application/json"));
    headers.insert("User-Agent", HeaderValue::from_static(USER_AGENT));
    headers.insert("Editor-Version", HeaderValue::from_static("vscode/1.95.0"));
    
    // These are compile-time constants, safe to expect
    let plugin_version = format!("copilot-chat/{}", COPILOT_VERSION);
    if let Ok(v) = HeaderValue::from_str(&plugin_version) {
        headers.insert("Editor-Plugin-Version", v);
    }
    
    headers.insert("Copilot-Integration-Id", HeaderValue::from_static("vscode-chat"));
    headers.insert("Openai-Intent", HeaderValue::from_static("conversation-panel"));
    headers.insert("X-Github-Api-Version", HeaderValue::from_static("2025-04-01"));
    
    // UUID is always valid ASCII
    let request_id = uuid::Uuid::new_v4().to_string();
    if let Ok(v) = HeaderValue::from_str(&request_id) {
        headers.insert("X-Request-Id", v);
    }
    
    if enable_vision {
        headers.insert("Copilot-Vision-Request", HeaderValue::from_static("true"));
    }
    
    headers
}
