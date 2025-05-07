# Copilot API

⚠️ **EDUCATIONAL PURPOSE ONLY** ⚠️
This project is a reverse-engineered implementation of the GitHub Copilot API created for educational purposes only. It is not officially supported by GitHub and should not be used in production environments.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E519XS7W)

## Project Overview

A wrapper around GitHub Copilot API to make it OpenAI compatible, making it usable for other tools like AI assistants, local interfaces, and development utilities.

## Demo

https://github.com/user-attachments/assets/7654b383-669d-4eb9-b23c-06d7aefee8c5

## Prerequisites

- Bun (>= 1.2.x)
- GitHub account with Copilot subscription (Individual or Business)

## Installation

To install dependencies, run:

```sh
bun install
```

## Using with docker

Build image

```sh
docker build -t copilot-api .
```

Run the container

```sh
docker run -p 4141:4141 copilot-api
```

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

Copilot API now uses a subcommand structure with two main commands:

- `start`: Start the Copilot API server (default command)
- `auth`: Run GitHub authentication flow without starting the server

## Command Line Options

### Start Command Options

The following command line options are available for the `start` command:

| Option         | Description                                  | Default | Alias |
| -------------- | -------------------------------------------- | ------- | ----- |
| --port         | Port to listen on                            | 4141    | -p    |
| --verbose      | Enable verbose logging                       | false   | -v    |
| --business     | Use a business plan GitHub account           | false   | none  |
| --manual       | Enable manual request approval               | false   | none  |
| --rate-limit   | Rate limit in seconds between requests       | none    | -r    |
| --wait         | Wait instead of error when rate limit is hit | false   | -w    |
| --github-token | Provide GitHub token directly                | none    | -g    |
| --vision       | Enable vision capabilities                   | false   | none  |

### Auth Command Options

| Option    | Description            | Default | Alias |
| --------- | ---------------------- | ------- | ----- |
| --verbose | Enable verbose logging | false   | -v    |

## Example Usage

Using with npx:

```sh
# Basic usage with start command
npx copilot-api@latest start

# Run on custom port with verbose logging
npx copilot-api@latest start --port 8080 --verbose

# Use with a Business GitHub account
npx copilot-api@latest start --business

# Enable manual approval for each request
npx copilot-api@latest start --manual

# Set rate limit to 30 seconds between requests
npx copilot-api@latest start --rate-limit 30

# Wait instead of error when rate limit is hit
npx copilot-api@latest start --rate-limit 30 --wait

# Provide GitHub token directly
npx copilot-api@latest start --github-token ghp_YOUR_TOKEN_HERE

# Enable vision capabilities
npx copilot-api@latest start --vision

# Run only the auth flow
npx copilot-api@latest auth

# Run auth flow with verbose logging
npx copilot-api@latest auth --verbose
```

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

- Consider using free models (e.g., Gemini, Mistral, Openrouter) as the `weak-model`
- Use architect mode sparingly
- Disable `yes-always` in your aider configuration
- Be mindful that Claude 3.7 thinking mode consumes more tokens
- Enable the `--manual` flag to review and approve each request before processing
- If you have a GitHub Business account with Copilot, use the `--business` flag

### Manual Request Approval

When using the `--manual` flag, the server will prompt you to approve each incoming request:

```
? Accept incoming request? › (y/N)
```

This helps you control usage and monitor requests in real-time.

## API Compatibility

The Copilot API provides compatibility with multiple API formats:

### OpenAI API Compatibility

The API is compatible with OpenAI's API format, supporting these endpoints:
- `/chat/completions` - For chat completions
- `/models` - For listing available models
- `/embeddings` - For creating embeddings

These endpoints are also available with the `/v1/` prefix for tools that expect it.

### Ollama API Compatibility

The API is compatible with a subset of Ollama's API endpoints:
- `/api/chat` - For chat completions
- `/api/tags` - For listing available models

