use std::sync::Arc;

use axum::{
    routing::{get, post},
    Json, Router,
};
use serde_json::json;

use crate::routes;
use crate::state::AppState;

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(routes::health::dashboard))
        .route("/health", get(health_check))
        .route("/healthz", get(health_check))
        .route("/v1/messages", post(routes::messages::handle_messages))
        .with_state(state)
}

/// Simple health check endpoint for Kubernetes/Docker
async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION")
    }))
}
