#!/bin/bash
# Truncate copilot-api server.log if it exceeds threshold.
# Run periodically by launchd (dev.copilot-api.log-watchdog).
#
# Threshold: COPILOT_LOG_MAX_BYTES env var, default 50 KB.
# Action: truncate in place (`: > file`); inode unchanged so launchd
#   StandardOutPath continues to append seamlessly.

set -u

LOG="/Users/steven.chen/working/sourcecode/tools/copilot-api/server.log"
MAX="${COPILOT_LOG_MAX_BYTES:-51200}"

[[ -f "$LOG" ]] || exit 0

size=$(stat -f %z "$LOG" 2>/dev/null || echo 0)

if (( size > MAX )); then
  : > "$LOG"
  echo "[log-watchdog $(date '+%F %T')] truncated $LOG (was ${size}B, threshold ${MAX}B)" >&2
fi
