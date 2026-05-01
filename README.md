# Copilot API Proxy

> [!WARNING]
> This is a reverse-engineered proxy of GitHub Copilot API. It is not supported by GitHub, and may break unexpectedly. Use at your own risk.

> [!WARNING]
> **GitHub Security Notice:**  
> Excessive automated or scripted use of Copilot (including rapid or bulk requests, such as via automated tools) may trigger GitHub's abuse-detection systems.  
> You may receive a warning from GitHub Security, and further anomalous activity could result in temporary suspension of your Copilot access.
>
> GitHub prohibits use of their servers for excessive automated bulk activity or any activity that places undue burden on their infrastructure.
>
> Please review:
>
> - [GitHub Acceptable Use Policies](https://docs.github.com/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github)
> - [GitHub Copilot Terms](https://docs.github.com/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot)
>
> Use this proxy responsibly to avoid account restrictions.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E519XS7W)

---

**Note:** If you are using [opencode](https://github.com/sst/opencode), you do not need this project. Opencode supports GitHub Copilot provider out of the box.

---

## Project Overview

A reverse-engineered proxy for the GitHub Copilot API that exposes it as an OpenAI and Anthropic compatible service. This allows you to use GitHub Copilot with any tool that supports the OpenAI Chat Completions API or the Anthropic Messages API, including to power [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

## Features

- **OpenAI & Anthropic Compatibility**: Exposes GitHub Copilot as an OpenAI-compatible (`/v1/chat/completions`, `/v1/models`, `/v1/embeddings`) and Anthropic-compatible (`/v1/messages`) API.
- **Claude Code Integration**: Easily configure and launch [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) to use Copilot as its backend with a simple command-line flag (`--claude-code`).
- **Usage Dashboard**: A web-based dashboard to monitor your Copilot API usage, view quotas, and see detailed statistics.
- **Rate Limit Control**: Manage API usage with rate-limiting options (`--rate-limit`) and a waiting mechanism (`--wait`) to prevent errors from rapid requests.
- **Manual Request Approval**: Manually approve or deny each API request for fine-grained control over usage (`--manual`).
- **Token Visibility**: Option to display GitHub and Copilot tokens during authentication and refresh for debugging (`--show-token`).
- **Flexible Authentication**: Authenticate interactively or provide a GitHub token directly, suitable for CI/CD environments.
- **Support for Different Account Types**: Works with individual, business, and enterprise GitHub Copilot plans.

## Demo

https://github.com/user-attachments/assets/7654b383-669d-4eb9-b23c-06d7aefee8c5

## Quick Start: Claude Code with Copilot

最快上手方式——一键安装并启动 Claude Code：

```bash
# 1. 安装引导（检查依赖、认证、配置 shell、生成 launchd plist）
./setup.sh

# 2. 重载 shell 配置
source ~/.zshrc   # 或 source ~/.bashrc

# 3. 启动
claude-copilot                # 默认 sonnet 模型
claude-copilot -m opus        # opus-4.7，高推理 effort
claude-copilot -m opus-med    # opus-4.7，中推理 effort（推荐日常使用）
claude-copilot -m haiku       # haiku，省配额
```

### 模型档位说明

`claude-copilot` 支持三层模型分工，Claude Code 会根据任务复杂度自动选择：

| 环境变量 | 用途 | 默认配置 |
|---------|------|---------|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 复杂任务：规划、架构决策、多步推理 | `claude-opus-4.7` |
| `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` | 常规任务：写代码、单测、调试 | `claude-sonnet-4.6` |
| `ANTHROPIC_SMALL_FAST_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 轻量任务：工具调用、文件读写、背景任务 | `claude-haiku-4.5` |

**`-m` 参数对应关系：**

| 参数 | 主模型 | Effort | 适用场景 |
|-----|-------|--------|---------|
| `sonnet`（默认）| sonnet-4.6 | 无 | 日常编码，subagent 用 opus-4.7 |
| `opus` / `opus47` / `opus-high` | opus-4.7 | `high` | 深度推理、复杂架构 |
| `opus-med` / `opus47-med` | opus-4.7 | `medium` | 均衡，推荐大多数重任务 |
| `opus46` | opus-4.6 | 无 | opus-4.6（无 effort 支持） |
| `haiku` | haiku-4.5 | 无 | 省配额、快速验证 |

> **Reasoning Effort 说明**：仅 `claude-opus-4.7` 支持 effort（`low/medium/high/xhigh/max`）。
> `opus-4.6`、`sonnet`、`haiku` 设置 effort 无效，proxy 会自动丢弃。

### 常用命令

```bash
claude-copilot --status       # 检查服务、认证、可用模型
claude-copilot --usage        # 查看配额用量（premium interactions 等）
claude-copilot --stop         # 停止服务
claude-copilot --daemon       # 守护模式（自动重启，Ctrl+C 退出）
claude-copilot --setup        # 详细环境检查向导
claude-copilot --port 4141    # 使用自定义端口
```

### 环境变量配置

可通过以下环境变量覆盖默认行为（在 shell 配置文件中设置）：

```bash
export COPILOT_PORT=1234                  # 服务端口
export COPILOT_SCRIPT_DIR=/path/to/repo   # copilot-api 源码目录
export COPILOT_TIMEOUT_MS=3000000         # API 超时（毫秒）
export COPILOT_AUTH_FILE=~/.local/share/copilot-api/github_token  # token 路径
```

### Shell 集成

`claude-copilot.sh` 是一个可 source 的 shell 函数文件，支持 zsh / bash：

```bash
# 手动添加到 ~/.zshrc 或 ~/.bashrc
export COPILOT_SCRIPT_DIR="/path/to/copilot-api"
source "$COPILOT_SCRIPT_DIR/claude-copilot.sh"
```

或直接运行 `./setup.sh` 自动完成配置。

---

## Prerequisites

- Bun (>= 1.2.x)
- GitHub account with Copilot subscription (individual, business, or enterprise)

## Installation

To install dependencies, run:

```sh
bun install
```

## Using with Docker

Build image

```sh
docker build -t copilot-api .
```

Run the container

```sh
# Create a directory on your host to persist the GitHub token and related data
mkdir -p ./copilot-data

# Run the container with a bind mount to persist the token
# This ensures your authentication survives container restarts

docker run -p 4141:4141 -v $(pwd)/copilot-data:/root/.local/share/copilot-api copilot-api
```

> **Note:**
> The GitHub token and related data will be stored in `copilot-data` on your host. This is mapped to `/root/.local/share/copilot-api` inside the container, ensuring persistence across restarts.

### Docker with Environment Variables

You can pass the GitHub token directly to the container using environment variables:

```sh
# Build with GitHub token
docker build --build-arg GH_TOKEN=your_github_token_here -t copilot-api .

# Run with GitHub token
docker run -p 4141:4141 -e GH_TOKEN=your_github_token_here copilot-api

# Run with additional options
docker run -p 4141:4141 -e GH_TOKEN=your_token copilot-api start --verbose --port 4141
```

### Docker Compose Example

```yaml
version: "3.8"
services:
  copilot-api:
    build: .
    ports:
      - "4141:4141"
    environment:
      - GH_TOKEN=your_github_token_here
    restart: unless-stopped
```

The Docker image includes:

- Multi-stage build for optimized image size
- Non-root user for enhanced security
- Health check for container monitoring
- Pinned base image version for reproducible builds

## Using with npx

You can run the project directly using npx:

```sh
npx copilot-api@latest start
```

With options:

```sh
npx copilot-api@latest start --port 8080
```

For authentication only:

```sh
npx copilot-api@latest auth
```

## Command Structure

Copilot API now uses a subcommand structure with these main commands:

- `start`: Start the Copilot API server. This command will also handle authentication if needed.
- `auth`: Run GitHub authentication flow without starting the server. This is typically used if you need to generate a token for use with the `--github-token` option, especially in non-interactive environments.
- `check-usage`: Show your current GitHub Copilot usage and quota information directly in the terminal (no server required).
- `debug`: Display diagnostic information including version, runtime details, file paths, and authentication status. Useful for troubleshooting and support.

## Command Line Options

### Start Command Options

The following command line options are available for the `start` command:

| Option         | Description                                                                   | Default    | Alias |
| -------------- | ----------------------------------------------------------------------------- | ---------- | ----- |
| --port         | Port to listen on                                                             | 4141       | -p    |
| --verbose      | Enable verbose logging                                                        | false      | -v    |
| --account-type | Account type to use (individual, business, enterprise)                        | individual | -a    |
| --manual       | Enable manual request approval                                                | false      | none  |
| --rate-limit   | Rate limit in seconds between requests                                        | none       | -r    |
| --wait         | Wait instead of error when rate limit is hit                                  | false      | -w    |
| --github-token | Provide GitHub token directly (must be generated using the `auth` subcommand) | none       | -g    |
| --claude-code  | Generate a command to launch Claude Code with Copilot API config              | false      | -c    |
| --show-token   | Show GitHub and Copilot tokens on fetch and refresh                           | false      | none  |
| --proxy-env    | Initialize proxy from environment variables                                   | false      | none  |

### Auth Command Options

| Option       | Description               | Default | Alias |
| ------------ | ------------------------- | ------- | ----- |
| --verbose    | Enable verbose logging    | false   | -v    |
| --show-token | Show GitHub token on auth | false   | none  |

### Debug Command Options

| Option | Description               | Default | Alias |
| ------ | ------------------------- | ------- | ----- |
| --json | Output debug info as JSON | false   | none  |

## API Endpoints

The server exposes several endpoints to interact with the Copilot API. It provides OpenAI-compatible endpoints and now also includes support for Anthropic-compatible endpoints, allowing for greater flexibility with different tools and services.

### OpenAI Compatible Endpoints

These endpoints mimic the OpenAI API structure.

| Endpoint                    | Method | Description                                               |
| --------------------------- | ------ | --------------------------------------------------------- |
| `POST /v1/chat/completions` | `POST` | Creates a model response for the given chat conversation. |
| `GET /v1/models`            | `GET`  | Lists the currently available models.                     |
| `POST /v1/embeddings`       | `POST` | Creates an embedding vector representing the input text.  |

### Anthropic Compatible Endpoints

These endpoints are designed to be compatible with the Anthropic Messages API.

| Endpoint                         | Method | Description                                                  |
| -------------------------------- | ------ | ------------------------------------------------------------ |
| `POST /v1/messages`              | `POST` | Creates a model response for a given conversation.           |
| `POST /v1/messages/count_tokens` | `POST` | Calculates the number of tokens for a given set of messages. |

### Usage Monitoring Endpoints

New endpoints for monitoring your Copilot usage and quotas.

| Endpoint     | Method | Description                                                  |
| ------------ | ------ | ------------------------------------------------------------ |
| `GET /usage` | `GET`  | Get detailed Copilot usage statistics and quota information. |
| `GET /token` | `GET`  | Get the current Copilot token being used by the API.         |

## Example Usage

Using with npx:

```sh
# Basic usage with start command
npx copilot-api@latest start

# Run on custom port with verbose logging
npx copilot-api@latest start --port 8080 --verbose

# Use with a business plan GitHub account
npx copilot-api@latest start --account-type business

# Use with an enterprise plan GitHub account
npx copilot-api@latest start --account-type enterprise

# Enable manual approval for each request
npx copilot-api@latest start --manual

# Set rate limit to 30 seconds between requests
npx copilot-api@latest start --rate-limit 30

# Wait instead of error when rate limit is hit
npx copilot-api@latest start --rate-limit 30 --wait

# Provide GitHub token directly
npx copilot-api@latest start --github-token ghp_YOUR_TOKEN_HERE

# Run only the auth flow
npx copilot-api@latest auth

# Run auth flow with verbose logging
npx copilot-api@latest auth --verbose

# Show your Copilot usage/quota in the terminal (no server needed)
npx copilot-api@latest check-usage

# Display debug information for troubleshooting
npx copilot-api@latest debug

# Display debug information in JSON format
npx copilot-api@latest debug --json

# Initialize proxy from environment variables (HTTP_PROXY, HTTPS_PROXY, etc.)
npx copilot-api@latest start --proxy-env
```

## Using the Usage Viewer

After starting the server, a URL to the Copilot Usage Dashboard will be displayed in your console. This dashboard is a web interface for monitoring your API usage.

1.  Start the server. For example, using npx:
    ```sh
    npx copilot-api@latest start
    ```
2.  The server will output a URL to the usage viewer. Copy and paste this URL into your browser. It will look something like this:
    `https://ericc-ch.github.io/copilot-api?endpoint=http://localhost:4141/usage`
    - If you use the `start.bat` script on Windows, this page will open automatically.

The dashboard provides a user-friendly interface to view your Copilot usage data:

- **API Endpoint URL**: The dashboard is pre-configured to fetch data from your local server endpoint via the URL query parameter. You can change this URL to point to any other compatible API endpoint.
- **Fetch Data**: Click the "Fetch" button to load or refresh the usage data. The dashboard will automatically fetch data on load.
- **Usage Quotas**: View a summary of your usage quotas for different services like Chat and Completions, displayed with progress bars for a quick overview.
- **Detailed Information**: See the full JSON response from the API for a detailed breakdown of all available usage statistics.
- **URL-based Configuration**: You can also specify the API endpoint directly in the URL using a query parameter. This is useful for bookmarks or sharing links. For example:
  `https://ericc-ch.github.io/copilot-api?endpoint=http://your-api-server/usage`

## Using with Claude Code

This proxy can be used to power [Claude Code](https://docs.anthropic.com/en/claude-code), an experimental conversational AI assistant for developers from Anthropic.

There are two ways to configure Claude Code to use this proxy:

### Interactive Setup with `--claude-code` flag

To get started, run the `start` command with the `--claude-code` flag:

```sh
npx copilot-api@latest start --claude-code
```

You will be prompted to select a primary model and a "small, fast" model for background tasks. After selecting the models, a command will be copied to your clipboard. This command sets the necessary environment variables for Claude Code to use the proxy.

Paste and run this command in a new terminal to launch Claude Code.

### Manual Configuration with `settings.json`

Alternatively, you can configure Claude Code by creating a `.claude/settings.json` file in your project's root directory. This file should contain the environment variables needed by Claude Code. This way you don't need to run the interactive setup every time.

Here is an example `.claude/settings.json` file:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4141",
    "ANTHROPIC_AUTH_TOKEN": "dummy",
    "ANTHROPIC_MODEL": "gpt-4.1",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-4.1",
    "ANTHROPIC_SMALL_FAST_MODEL": "gpt-4.1",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-4.1",
    "DISABLE_NON_ESSENTIAL_MODEL_CALLS": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  },
  "permissions": {
    "deny": [
      "WebSearch"
    ]
  }
}
```

You can find more options here: [Claude Code settings](https://docs.anthropic.com/en/docs/claude-code/settings#environment-variables)

You can also read more about IDE integration here: [Add Claude Code to your IDE](https://docs.anthropic.com/en/docs/claude-code/ide-integrations)

## Running from Source

The project can be run from source in several ways:

### Development Mode

```sh
bun run dev
```

### Production Mode

```sh
bun run start
```

## Usage Tips

- To avoid hitting GitHub Copilot's rate limits, you can use the following flags:
  - `--manual`: Enables manual approval for each request, giving you full control over when requests are sent.
  - `--rate-limit <seconds>`: Enforces a minimum time interval between requests. For example, `copilot-api start --rate-limit 30` will ensure there's at least a 30-second gap between requests.
  - `--wait`: Use this with `--rate-limit`. It makes the server wait for the cooldown period to end instead of rejecting the request with an error. This is useful for clients that don't automatically retry on rate limit errors.
- If you have a GitHub business or enterprise plan account with Copilot, use the `--account-type` flag (e.g., `--account-type business`). See the [official documentation](https://docs.github.com/en/enterprise-cloud@latest/copilot/managing-copilot/managing-github-copilot-in-your-organization/managing-access-to-github-copilot-in-your-organization/managing-github-copilot-access-to-your-organizations-network#configuring-copilot-subscription-based-network-routing-for-your-enterprise-or-organization) for more details.
