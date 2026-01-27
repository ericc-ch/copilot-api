use std::time::Duration;
use anyhow::{anyhow, Result};
use serde::Deserialize;
use tracing::info;

use crate::error::AppError;

// GitHub Copilot's OAuth client ID (from VS Code extension)
const GITHUB_CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";
const GITHUB_SCOPES: &str = "read:user";

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
}

pub async fn device_flow_auth(client: &reqwest::Client) -> Result<String> {
    // Step 1: Request device and user codes
    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", GITHUB_CLIENT_ID),
            ("scope", GITHUB_SCOPES),
        ])
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(anyhow!("Failed to get device code: {}", resp.status()));
    }

    let codes: DeviceCodeResponse = resp.json().await?;

    // Step 2: Display instructions to user
    println!();
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("  To authenticate, visit: {}", codes.verification_uri);
    println!("  And enter code: {}", codes.user_code);
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!();

    // Step 3: Poll for access token
    let mut interval = Duration::from_secs(codes.interval);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(codes.expires_in);

    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(AppError::AuthError("Device code expired".to_string()).into());
        }

        tokio::time::sleep(interval).await;

        let resp = client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", GITHUB_CLIENT_ID),
                ("device_code", codes.device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await?;

        let token_resp: AccessTokenResponse = resp.json().await?;

        if let Some(token) = token_resp.access_token {
            info!("GitHub authentication successful!");
            return Ok(token);
        }

        match token_resp.error.as_deref() {
            Some("authorization_pending") => {
                // User hasn't authorized yet, keep polling
                continue;
            }
            Some("slow_down") => {
                // Slow down polling
                interval += Duration::from_secs(5);
                continue;
            }
            Some("expired_token") => {
                return Err(AppError::AuthError("Device code expired".to_string()).into());
            }
            Some("access_denied") => {
                return Err(AppError::AuthError("User denied access".to_string()).into());
            }
            Some(err) => {
                return Err(AppError::AuthError(err.to_string()).into());
            }
            None => {
                continue;
            }
        }
    }
}
