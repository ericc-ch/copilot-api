use std::time::Duration;
use anyhow::{anyhow, Result};
use serde::Deserialize;
use tracing::{debug, error, info, warn};

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
    debug!("Requesting device code from GitHub");
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
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        error!("Failed to get device code: {} - {}", status, body);
        return Err(anyhow!("Failed to get device code: {} - {}", status, body));
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
            error!("Device code expired before user completed authentication");
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
                debug!("Waiting for user authorization...");
                continue;
            }
            Some("slow_down") => {
                // Slow down polling
                warn!("GitHub requested slower polling, increasing interval");
                interval += Duration::from_secs(5);
                continue;
            }
            Some("expired_token") => {
                error!("Device code expired");
                return Err(AppError::AuthError("Device code expired".to_string()).into());
            }
            Some("access_denied") => {
                error!("User denied access during GitHub authentication");
                return Err(AppError::AuthError("User denied access".to_string()).into());
            }
            Some(err) => {
                error!("GitHub OAuth error: {}", err);
                return Err(AppError::AuthError(err.to_string()).into());
            }
            None => {
                continue;
            }
        }
    }
}
