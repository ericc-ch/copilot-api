#!/bin/sh
exec bun run dist/main.js start -g "$GH_TOKEN"
