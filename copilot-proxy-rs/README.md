# copilot-proxy-rs

A minimal Rust proxy that exposes GitHub Copilot as an Anthropic-compatible API for [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

## Features

- 🦀 **Single static binary** (~3-4MB)
- 🚀 **Near-instant startup** (<10ms)
- 💾 **Low memory footprint** (~2-5MB idle)
- 🔐 **GitHub Device Flow auth**
- 🔄 **Automatic token refresh**
- 📡 **Full SSE streaming support**
- 🛠️ **Tool use (function calling) support**

## Installation

### From Source

```bash
# Clone the repo
cd copilot-proxy-rs

# Build release binary
cargo build --release

# Binary is at target/release/copilot-proxy
```

### Cross-compile for Linux

```bash
# Add musl target for static linking
rustup target add x86_64-unknown-linux-musl

# Build static binary
cargo build --release --target x86_64-unknown-linux-musl
```

## Usage

### First Run (Authentication)

```bash
./copilot-proxy

# Follow the prompts to authenticate with GitHub
# Token is saved to ~/.local/share/copilot-proxy/github_token
```

### Run with Claude Code

```bash
# Terminal 1: Start the proxy
./copilot-proxy --port 4141

# Terminal 2: Run Claude Code
export ANTHROPIC_BASE_URL=http://localhost:4141
export ANTHROPIC_AUTH_TOKEN=dummy
export ANTHROPIC_MODEL=gpt-4o
claude
```

### Command Line Options

```
Options:
  -p, --port <PORT>              Port to listen on [default: 4141]
  -r, --rate-limit <SECONDS>     Rate limit between requests
  -g, --github-token <TOKEN>     GitHub token (skip interactive auth)
  -v, --verbose                  Enable verbose logging
  -a, --account-type <TYPE>      Account type: individual, business, enterprise [default: individual]
  -h, --help                     Print help
  -V, --version                  Print version
```

### Environment Variables

All options can be set via environment variables:

- `PORT` - Server port
- `RATE_LIMIT` - Rate limit in seconds
- `GH_TOKEN` - GitHub token
- `VERBOSE` - Enable verbose logging
- `ACCOUNT_TYPE` - Copilot account type

## Docker

### Minimal Image (~5MB)

```dockerfile
FROM scratch
COPY target/x86_64-unknown-linux-musl/release/copilot-proxy /
USER 1000:1000
ENTRYPOINT ["/copilot-proxy"]
```

```bash
# Build
docker build -t copilot-proxy .

# Run
docker run -p 4141:4141 -e GH_TOKEN=your_token copilot-proxy
```

## API Endpoints

### POST /v1/messages

Anthropic Messages API compatible endpoint. Translates requests to OpenAI format for Copilot.

### GET /

Health check endpoint.

## How It Works

1. **Authentication**: Uses GitHub's device flow OAuth to get a user token
2. **Token Exchange**: Exchanges GitHub token for Copilot API token
3. **Request Translation**: Converts Anthropic Messages API format to OpenAI Chat Completions format
4. **Response Translation**: Converts OpenAI responses (including streaming) back to Anthropic format

## Supported Features

| Feature | Status |
|---------|--------|
| Text messages | ✅ |
| System prompts | ✅ |
| Streaming | ✅ |
| Tool use | ✅ |
| Images | ✅ |
| Rate limiting | ✅ |
| Token persistence | ✅ |

## License

MIT
