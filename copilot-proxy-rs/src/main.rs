use std::sync::Arc;

use clap::Parser;
use tracing::info;

mod auth;
mod config;
mod copilot;
mod error;
mod routes;
mod server;
mod state;
mod translate;

use config::TokenStore;
use state::AppState;

#[derive(Parser, Debug)]
#[command(name = "copilot-proxy", version, about = "Minimal Copilot → Anthropic proxy for Claude Code")]
struct Args {
    /// Port to listen on
    #[arg(short, long, default_value = "4141", env = "PORT")]
    port: u16,

    /// Rate limit (seconds between requests)
    #[arg(short, long, env = "RATE_LIMIT")]
    rate_limit: Option<u64>,

    /// GitHub token (skip interactive auth)
    #[arg(short, long, env = "GH_TOKEN")]
    github_token: Option<String>,

    /// Enable verbose logging
    #[arg(short, long, env = "VERBOSE")]
    verbose: bool,

    /// Account type: individual, business, or enterprise
    #[arg(short, long, default_value = "individual", env = "ACCOUNT_TYPE")]
    account_type: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Setup logging
    let filter = if args.verbose { "debug" } else { "info" };
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .init();

    info!("Starting copilot-proxy v{}", env!("CARGO_PKG_VERSION"));

    // Get or create GitHub token
    let github_token = match args.github_token {
        Some(token) => {
            info!("Using provided GitHub token");
            token
        }
        None => {
            // Try loading from disk
            let store = TokenStore::new()?;
            match store.load().await {
                Some(token) => {
                    info!("Loaded GitHub token from disk");
                    token
                }
                None => {
                    info!("Starting GitHub device flow authentication...");
                    let client = reqwest::Client::new();
                    let token = auth::device_flow_auth(&client).await?;
                    store.save(&token).await?;
                    info!("GitHub token saved to disk");
                    token
                }
            }
        }
    };

    // Build shared state
    let state = Arc::new(AppState::new(
        github_token,
        args.account_type,
        args.port,
        args.rate_limit,
    ));

    // Start token refresh background task
    let state_clone = state.clone();
    tokio::spawn(async move {
        copilot::token_refresh_loop(state_clone).await;
    });

    // Wait for initial Copilot token
    info!("Fetching initial Copilot token...");
    loop {
        if state.get_copilot_token().await.is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    info!("Copilot token acquired");

    // Start HTTP server
    let app = server::create_router(state);
    let addr = format!("0.0.0.0:{}", args.port);
    
    info!("🚀 Listening on http://localhost:{}", args.port);
    info!("   Set ANTHROPIC_BASE_URL=http://localhost:{}", args.port);
    info!("   Set ANTHROPIC_AUTH_TOKEN=dummy");
    
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
