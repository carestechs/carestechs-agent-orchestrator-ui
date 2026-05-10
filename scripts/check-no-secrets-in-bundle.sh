#!/usr/bin/env bash
# Scans the SPA bundle for accidental leaks of the orchestrator API key value
# and any literal `Authorization: Bearer` string. Exits non-zero on match.
#
# IMPORTANT: never prints the matched key value — only the offending file path
# and line number. The key is only present in the script's environment, not on
# disk.
set -euo pipefail

DIST_DIR="${DIST_DIR:-dist/spa/browser}"

if [ ! -d "$DIST_DIR" ]; then
  echo "[check-no-secrets] $DIST_DIR does not exist; skipping (run after a build)." >&2
  exit 0
fi

if [ -z "${ORCHESTRATOR_API_KEY:-}" ]; then
  echo "[check-no-secrets] ORCHESTRATOR_API_KEY not set; skipping value-scan." >&2
  echo "[check-no-secrets] (Authorization-literal scan still runs.)" >&2
  SKIP_KEY_SCAN=1
else
  SKIP_KEY_SCAN=0
fi

FAIL=0

# Scan 1: literal API key value. NEVER print the matched value — only
# `path:lineno`.
if [ "$SKIP_KEY_SCAN" -eq 0 ]; then
  MATCHES=$(grep -rnFI \
    --include='*.js' --include='*.css' --include='*.html' --include='*.map' \
    -e "$ORCHESTRATOR_API_KEY" "$DIST_DIR" 2>/dev/null | cut -d: -f1,2 || true)
  if [ -n "$MATCHES" ]; then
    echo "[check-no-secrets] FAIL: orchestrator API key value found in build output:" >&2
    echo "$MATCHES" >&2
    FAIL=1
  fi
fi

# Scan 2: literal "Authorization: Bearer". Safe to print since the literal
# string carries no secret.
AUTH_MATCHES=$(grep -rniI \
  --include='*.js' --include='*.css' --include='*.html' --include='*.map' \
  -E 'Authorization[[:space:]]*:[[:space:]]*Bearer' "$DIST_DIR" 2>/dev/null || true)
if [ -n "$AUTH_MATCHES" ]; then
  echo "[check-no-secrets] FAIL: 'Authorization: Bearer' literal found in build output:" >&2
  echo "$AUTH_MATCHES" >&2
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "[check-no-secrets] OK: no API key value or Authorization literal in $DIST_DIR."
