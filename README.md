# Copilot API

⚠️ **EDUCATIONAL PURPOSE ONLY** ⚠️
This project is a reverse-engineered implementation of the GitHub Copilot API created for educational purposes only. It is not officially supported by GitHub and should not be used in production environments.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E519XS7W)

## Project Overview

A wrapper around GitHub Copilot API to make it OpenAI compatible, making it usable for other tools like AI assistants, local interfaces, and development utilities.

## Features

- OpenAI Compatible API endpoint (`/v1/chat/completions`)
- Handles GitHub Copilot authentication (Personal & Business)
- Fetches available Copilot models (`/v1/models`)
- Supports streaming responses
- Automatic message sanitization for improved compatibility
- Built-in support for vision requests (via automatic header management)
- Optional manual request approval (`--manual`)
- Rate limiting (`--rate-limit`, `--wait`)

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

# Run only the auth flow
npx copilot-api@latest auth

# Run auth flow with verbose logging
npx copilot-api@latest auth --verbose
```

> **Note**: For backward compatibility, if no subcommand is provided, the `start` command will be used as default.

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

### Message Sanitization

To ensure compatibility with the underlying Copilot models and prevent errors, the API automatically performs several sanitization steps on incoming messages:

1. **Content Flattening:** If message content is an array of parts, it's joined into a single string:
   ```javascript
   // Input message with array content
   { 
     "role": "user", 
     "content": [
       { "type": "text", "text": "Hello" },
       { "type": "text", "text": " world" }
     ]
   }
   
   // Converted to:
   { "role": "user", "content": "Hello world" }
   ```

2. **Internal Tag Removal:** 
   * `<environment_details>` blocks are removed entirely (including content):
     ```javascript
     // Input:
     "start <environment_details>debug info</environment_details> end"
     
     // Sanitized to:
     "start  end"
     ```
   * `<task>` tags are stripped while preserving the content within:
     ```javascript
     // Input:
     "<task>actual instruction</task>"
     
     // Sanitized to:
     "actual instruction"
     ```

3. **Whitespace Trimming:** Removes leading/trailing whitespace from message content.

4. **Empty Message Filtering:** Messages that become empty after sanitization are automatically dropped.

This sanitization process is particularly important for client applications that may use these format variations, ensuring consistent handling and preventing 400 errors from the underlying Copilot API.

### Vision Support

The API automatically adds the required `Copilot-Vision-Request` header (addressing issue #16) to ensure image processing works properly with multimodal models like GPT-4o:

```javascript
// Header added automatically to all requests
headers["Copilot-Vision-Request"] = JSON.stringify({ enable: true })
```

This eliminates the `missing required Copilot-Vision-Request header for vision requests` error that would otherwise occur when sending image content to the models.

## Roadmap

- [x] Manual authentication flow (`auth` command)
- [x] Manual request approval system (`--manual` flag)
- [x] Rate limiting implementation (`--rate-limit`, `--wait` flags)
- [x] Token counting (`getTokenCount` utility)
- [x] Automatic message sanitization (flattening, tag stripping/removal)
- [x] Vision request support (automatic header addition)
- [x] OpenAI-compatible endpoints for `/chat/completions`, `/models`, `/embeddings`
- [x] Docker support
- [x] NPX execution support
- [ ] Dynamic vision header support (only when vision content detected)
- [ ] Configuration file support (e.g., for API keys, default models)
- [ ] Caching mechanism for API responses (e.g., models endpoint)
- [ ] More robust error handling and reporting
