use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};

use crate::routes;
use crate::state::AppState;

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(routes::health::dashboard))
        .route("/v1/messages", post(routes::messages::handle_messages))
        .with_state(state)
}
