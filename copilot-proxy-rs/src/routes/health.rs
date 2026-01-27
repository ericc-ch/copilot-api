use axum::{
    extract::State,
    response::{Html, IntoResponse},
};
use std::sync::Arc;

use crate::state::AppState;

pub async fn dashboard(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let uptime = state.uptime();
    let uptime_secs = uptime.as_secs();
    let hours = uptime_secs / 3600;
    let minutes = (uptime_secs % 3600) / 60;
    let seconds = uptime_secs % 60;
    let uptime_str = format!("{:02}:{:02}:{:02}", hours, minutes, seconds);

    let token_expires = match state.get_token_expires_in().await {
        Some(dur) => {
            let secs = dur.as_secs();
            let mins = secs / 60;
            let secs = secs % 60;
            format!("{}m {}s", mins, secs)
        }
        None => "No token".to_string(),
    };

    let has_token = state.get_copilot_token().await.is_some();
    let status_icon = if has_token { "🟢" } else { "🟡" };
    let status_text = if has_token { "Ready" } else { "Initializing..." };

    let request_count = state.stats.get_request_count();
    let error_count = state.stats.get_error_count();
    let port = state.port;

    let html = format!(r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="5">
    <title>Copilot Proxy</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #e4e4e4;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }}
        .container {{
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
        }}
        .header {{
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 30px;
        }}
        .header h1 {{
            font-size: 24px;
            font-weight: 600;
        }}
        .status {{
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 18px;
            margin-bottom: 30px;
            padding: 12px 16px;
            background: rgba(255,255,255,0.05);
            border-radius: 8px;
        }}
        .grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 30px;
        }}
        .stat {{
            background: rgba(255,255,255,0.03);
            padding: 16px;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.05);
        }}
        .stat-label {{
            font-size: 12px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }}
        .stat-value {{
            font-size: 24px;
            font-weight: 600;
            font-family: 'SF Mono', 'Fira Code', monospace;
        }}
        .config {{
            background: rgba(255,255,255,0.03);
            border-radius: 12px;
            padding: 16px;
            border: 1px solid rgba(255,255,255,0.05);
        }}
        .config-title {{
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 12px;
        }}
        .config-item {{
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }}
        .config-item:last-child {{ margin-bottom: 0; }}
        .config-code {{
            flex: 1;
            background: rgba(0,0,0,0.3);
            padding: 8px 12px;
            border-radius: 6px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 12px;
            overflow-x: auto;
            white-space: nowrap;
        }}
        .copy-btn {{
            background: #4f46e5;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        }}
        .copy-btn:hover {{ background: #4338ca; }}
        .copy-btn:active {{ background: #3730a3; }}
        .footer {{
            margin-top: 24px;
            text-align: center;
            font-size: 12px;
            color: #666;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span style="font-size: 32px;">🐙</span>
            <h1>Copilot Proxy</h1>
        </div>
        
        <div class="status">
            <span>{status_icon}</span>
            <span>{status_text}</span>
        </div>
        
        <div class="grid">
            <div class="stat">
                <div class="stat-label">Requests</div>
                <div class="stat-value">{request_count}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Errors</div>
                <div class="stat-value">{error_count}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Token Expires</div>
                <div class="stat-value" style="font-size: 18px;">{token_expires}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Uptime</div>
                <div class="stat-value" style="font-size: 18px;">{uptime_str}</div>
            </div>
        </div>
        
        <div class="config">
            <div class="config-title">📋 Quick Setup</div>
            <div class="config-item">
                <div class="config-code">ANTHROPIC_BASE_URL=http://localhost:{port}</div>
                <button class="copy-btn" onclick="copy('ANTHROPIC_BASE_URL=http://localhost:{port}')">Copy</button>
            </div>
            <div class="config-item">
                <div class="config-code">ANTHROPIC_API_KEY=anything</div>
                <button class="copy-btn" onclick="copy('ANTHROPIC_API_KEY=anything')">Copy</button>
            </div>
        </div>
        
        <div class="footer">
            Auto-refreshes every 5 seconds
        </div>
    </div>
    
    <script>
        function copy(text) {{
            navigator.clipboard.writeText(text);
        }}
    </script>
</body>
</html>"#);

    Html(html)
}
