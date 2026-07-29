#!/usr/bin/env bash
#
# Validate /responses tool forwarding against a LIVE /responses-only Copilot model.
#
# This is the one thing the unit tests cannot prove: that copilot-api's
# chat-completions -> Responses API translation matches Copilot's actual wire
# format (e.g. call_id vs id) for a model that ONLY supports /responses.
#
# Prereqs:
#   - copilot-api server running locally (default http://localhost:4141)
#   - jq installed
#
# Usage:
#   ./scripts/validate-responses-tools.sh
#   BASE_URL=http://localhost:4141 MODEL=gpt-5.4-mini ./scripts/validate-responses-tools.sh
#
# Pick a model whose supported_endpoints is /responses-only. From `bun run models`,
# good candidates: gpt-5.4-mini, gpt-5.3-codex, gpt-5.5, gpt-5.6-sol,
# mai-code-1-flash-picker.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4141}"
MODEL="${MODEL:-gpt-5.4-mini}"

pass() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1"; exit 1; }
info() { printf '\033[36m• %s\033[0m\n' "$1"; }

info "Server: $BASE_URL"
info "Model:  $MODEL"

# 0. Confirm the model is actually /responses-only (otherwise this proves nothing).
endpoints="$(curl -sS --max-time 15 "$BASE_URL/v1/models" \
  | jq -r --arg m "$MODEL" '.data[] | select(.id==$m) | (.supported_endpoints // []) | join(",")' || true)"
if [ -z "$endpoints" ]; then
  info "Note: /v1/models did not list supported_endpoints for $MODEL (the OpenAI-shaped models route omits them). Proceeding anyway."
else
  info "supported_endpoints: $endpoints"
  case "$endpoints" in
    *"/chat/completions"*) info "WARNING: $MODEL also supports /chat/completions, so this will NOT exercise the /responses path. Pick a /responses-only model." ;;
  esac
fi

weather_tool='{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Get the current weather for a city",
    "parameters": {
      "type": "object",
      "properties": { "city": { "type": "string", "description": "City name" } },
      "required": ["city"]
    }
  }
}'

# 1. Non-streaming: model should emit a tool_call we can parse.
info "Test 1: non-streaming tool call"
req1="$(jq -n --arg model "$MODEL" --argjson tool "$weather_tool" '{
  model: $model,
  max_tokens: 256,
  temperature: 0,
  tools: [$tool],
  tool_choice: "auto",
  messages: [{ role: "user", content: "What is the weather in Boston? Use the get_weather tool." }]
}')"

resp1="$(curl -sS --max-time 60 "$BASE_URL/v1/chat/completions" \
  -H 'content-type: application/json' -d "$req1")"

echo "$resp1" | jq '.' >/dev/null 2>&1 || fail "Response 1 was not valid JSON: $resp1"

tool_name="$(echo "$resp1" | jq -r '.choices[0].message.tool_calls[0].function.name // empty')"
tool_id="$(echo "$resp1" | jq -r '.choices[0].message.tool_calls[0].id // empty')"
tool_args="$(echo "$resp1" | jq -r '.choices[0].message.tool_calls[0].function.arguments // empty')"
finish="$(echo "$resp1" | jq -r '.choices[0].finish_reason // empty')"

if [ -z "$tool_name" ]; then
  fail "No tool_call returned. The model may have answered directly, or the /responses function_call mapping is wrong. Raw: $(echo "$resp1" | jq -c '.choices[0]')"
fi
[ "$tool_name" = "get_weather" ] || fail "Tool name mismatch: got '$tool_name'"
[ -n "$tool_id" ] || fail "tool_calls[0].id is empty (call_id mapping likely wrong)"
echo "$tool_args" | jq '.' >/dev/null 2>&1 || fail "tool arguments are not valid JSON: '$tool_args'"
pass "non-streaming tool call: name=$tool_name id=$tool_id finish=$finish args=$tool_args"

# 2. Round-trip: feed the tool result back as a tool message; expect a normal answer.
info "Test 2: tool-result round-trip (function_call_output mapping)"
req2="$(jq -n --arg model "$MODEL" --argjson tool "$weather_tool" \
  --arg id "$tool_id" --arg args "$tool_args" '{
  model: $model,
  max_tokens: 256,
  temperature: 0,
  tools: [$tool],
  messages: [
    { role: "user", content: "What is the weather in Boston? Use the get_weather tool." },
    { role: "assistant", content: null, tool_calls: [
      { id: $id, type: "function", function: { name: "get_weather", arguments: $args } }
    ]},
    { role: "tool", tool_call_id: $id, content: "Sunny, 72F" }
  ]
}')"

resp2="$(curl -sS --max-time 60 "$BASE_URL/v1/chat/completions" \
  -H 'content-type: application/json' -d "$req2")"

echo "$resp2" | jq '.' >/dev/null 2>&1 || fail "Response 2 was not valid JSON: $resp2"
content2="$(echo "$resp2" | jq -r '.choices[0].message.content // empty')"
[ -n "$content2" ] || fail "No content after feeding tool result back (function_call_output mapping likely wrong). Raw: $(echo "$resp2" | jq -c '.choices[0]')"
pass "tool-result round-trip produced an answer: ${content2:0:120}"

# 3. Streaming: confirm tool_call deltas reconstruct.
info "Test 3: streaming tool call"
req3="$(echo "$req1" | jq '. + {stream: true}')"
stream="$(curl -sS --max-time 60 -N "$BASE_URL/v1/chat/completions" \
  -H 'content-type: application/json' -d "$req3")"

# Reassemble tool name + arguments from SSE data lines.
sname="$(echo "$stream" | sed -n 's/^data: //p' | grep -v '^\[DONE\]$' \
  | jq -rs 'map(.choices[0].delta.tool_calls[0].function.name // empty) | map(select(length>0)) | first // empty' 2>/dev/null || true)"
sargs="$(echo "$stream" | sed -n 's/^data: //p' | grep -v '^\[DONE\]$' \
  | jq -rs 'map(.choices[0].delta.tool_calls[0].function.arguments // empty) | join("")' 2>/dev/null || true)"

if [ -z "$sname" ]; then
  fail "Streaming produced no tool_call name. The output_item.added -> tool_calls mapping may be wrong. First lines: $(echo "$stream" | head -3)"
fi
[ "$sname" = "get_weather" ] || fail "Streaming tool name mismatch: '$sname'"
echo "$sargs" | jq '.' >/dev/null 2>&1 || fail "Streaming reassembled args are not valid JSON: '$sargs'"
pass "streaming tool call: name=$sname args=$sargs"

printf '\n\033[32mAll /responses tool-forwarding checks passed for %s.\033[0m\n' "$MODEL"
