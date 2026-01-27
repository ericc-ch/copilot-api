use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

pub struct AppState {
    pub github_token: String,
    pub account_type: String,
    pub port: u16,
    pub http_client: reqwest::Client,
    copilot_token: RwLock<Option<String>>,
    token_expires_at: RwLock<Option<Instant>>,
    rate_limiter: Option<RateLimiter>,
    pub stats: Stats,
    pub start_time: Instant,
}

pub struct Stats {
    pub request_count: AtomicU64,
    pub error_count: AtomicU64,
}

impl Stats {
    pub fn new() -> Self {
        Self {
            request_count: AtomicU64::new(0),
            error_count: AtomicU64::new(0),
        }
    }

    pub fn inc_requests(&self) {
        self.request_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_errors(&self) {
        self.error_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn get_request_count(&self) -> u64 {
        self.request_count.load(Ordering::Relaxed)
    }

    pub fn get_error_count(&self) -> u64 {
        self.error_count.load(Ordering::Relaxed)
    }
}

pub struct RateLimiter {
    min_interval: Duration,
    last_request: RwLock<Instant>,
}

impl RateLimiter {
    pub fn new(seconds: u64) -> Self {
        Self {
            min_interval: Duration::from_secs(seconds),
            last_request: RwLock::new(Instant::now() - Duration::from_secs(seconds + 1)),
        }
    }

    pub async fn wait(&self) {
        let mut last = self.last_request.write().await;
        let elapsed = last.elapsed();
        
        if elapsed < self.min_interval {
            let wait_time = self.min_interval - elapsed;
            tracing::debug!("Rate limiting: waiting {:?}", wait_time);
            tokio::time::sleep(wait_time).await;
        }
        
        *last = Instant::now();
    }
}

impl AppState {
    pub fn new(github_token: String, account_type: String, port: u16, rate_limit_secs: Option<u64>) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(300)) // 5 min timeout for streaming
            .build()
            .expect("Failed to build HTTP client");

        Self {
            github_token,
            account_type,
            port,
            http_client,
            copilot_token: RwLock::new(None),
            token_expires_at: RwLock::new(None),
            rate_limiter: rate_limit_secs.map(RateLimiter::new),
            stats: Stats::new(),
            start_time: Instant::now(),
        }
    }

    pub async fn set_copilot_token(&self, token: String, expires_in_secs: i64) {
        let mut guard = self.copilot_token.write().await;
        *guard = Some(token);
        drop(guard);

        let mut exp_guard = self.token_expires_at.write().await;
        *exp_guard = Some(Instant::now() + Duration::from_secs(expires_in_secs as u64));
    }

    pub async fn get_copilot_token(&self) -> Option<String> {
        let guard = self.copilot_token.read().await;
        guard.clone()
    }

    pub async fn get_token_expires_in(&self) -> Option<Duration> {
        let guard = self.token_expires_at.read().await;
        guard.map(|exp| exp.saturating_duration_since(Instant::now()))
    }

    pub fn copilot_base_url(&self) -> String {
        match self.account_type.as_str() {
            "individual" => "https://api.githubcopilot.com".to_string(),
            other => format!("https://api.{}.githubcopilot.com", other),
        }
    }

    pub fn uptime(&self) -> Duration {
        self.start_time.elapsed()
    }

    pub async fn check_rate_limit(&self) {
        if let Some(limiter) = &self.rate_limiter {
            limiter.wait().await;
        }
    }
}
