#!/bin/sh
if [ "$1" = "--auth" ]; then
  # Run auth command
  exec bun run dist/main.js auth
else
  # Default command
  # Bind to 0.0.0.0 inside the container so published ports work;
  # restrict exposure on the host side (e.g. -p 127.0.0.1:4141:4141).
  exec bun run dist/main.js start --host 0.0.0.0 -g "$GH_TOKEN" "$@"
fi

