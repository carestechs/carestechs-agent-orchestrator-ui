#!/usr/bin/env bash
# Post-deploy readiness smoke. Run after `docker compose -f docker-compose.prod.yml up -d`.
#
# The docker HEALTHCHECK proves nginx serves the index (liveness). This script
# proves the harder property: the SPA can actually reach the orchestrator with
# CORS, the bundle was built with the right URL, and the configured API key is
# accepted. Four checks; each failure prints one actionable line.
#
# Reads inputs from env. Never accepts secrets on the command line.
#
#   SPA_URL                 default http://127.0.0.1:4200
#   ORCHESTRATOR_BASE_URL   default http://127.0.0.1:8000
#   ORCHESTRATOR_API_KEY    (no default — auth round-trip is skipped if unset)

set -uo pipefail

SPA_URL="${SPA_URL:-http://127.0.0.1:4200}"
ORCHESTRATOR_BASE_URL="${ORCHESTRATOR_BASE_URL:-http://127.0.0.1:8000}"
ORCHESTRATOR_API_KEY="${ORCHESTRATOR_API_KEY:-}"

FAIL=0
say_fail() { echo "[smoke-prod] FAIL: $1" >&2; FAIL=1; }
say_ok()   { echo "[smoke-prod] OK:   $1"; }

echo "[smoke-prod] SPA at $SPA_URL, orchestrator at $ORCHESTRATOR_BASE_URL."

# 1. SPA index reachable and contains <app-root>.
index=$(curl -s --connect-timeout 5 "$SPA_URL/" 2>/dev/null || true)
if echo "$index" | grep -q '<app-root'; then
  say_ok "SPA index served at $SPA_URL/."
else
  say_fail "SPA index not reachable or missing <app-root> at $SPA_URL/ (is the container running? \`docker compose -f docker-compose.prod.yml ps\`)."
fi

# 2. Bundle was built with the expected orchestrator URL. The index references
#    JS chunks; grep each for the URL until found.
chunks=$(echo "$index" | grep -oE '[^"]*\.js' | head -20 || true)
found_url=0
for chunk in $chunks; do
  # Chunk references in the index can be relative or absolute; normalize.
  if [[ "$chunk" == /* ]] || [[ "$chunk" == http* ]]; then
    url="$chunk"
  else
    url="$SPA_URL/$chunk"
  fi
  # If relative path, prepend SPA_URL.
  if [[ "$url" != http* ]]; then
    url="$SPA_URL$url"
  fi
  if curl -s --connect-timeout 5 "$url" 2>/dev/null | grep -qF "$ORCHESTRATOR_BASE_URL"; then
    found_url=1
    break
  fi
done
if [ "$found_url" -eq 1 ]; then
  say_ok "Bundle contains ORCHESTRATOR_BASE_URL ($ORCHESTRATOR_BASE_URL)."
else
  say_fail "Bundle does not contain ORCHESTRATOR_BASE_URL ($ORCHESTRATOR_BASE_URL) — was the container built with the right --build-arg? Try \`docker compose -f docker-compose.prod.yml up -d --build\`."
fi

# 3. CORS preflight from the SPA's origin succeeds.
hdr=$(curl -s -o /dev/null -D - -X OPTIONS \
  -H "Origin: $SPA_URL" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" \
  --connect-timeout 5 \
  "$ORCHESTRATOR_BASE_URL/v1/agents" 2>/dev/null | tr -d '\r' || true)
if echo "$hdr" | grep -qiE "^access-control-allow-origin:[[:space:]]*(\*|$SPA_URL)"; then
  say_ok "CORS preflight from $SPA_URL passes."
else
  say_fail "CORS preflight from $SPA_URL failed (orchestrator must allow this origin and 'authorization' header — see scripts/check-orchestrator-cors.sh for details)."
fi

# 4. Authenticated GET /v1/agents succeeds.
if [ -z "$ORCHESTRATOR_API_KEY" ]; then
  echo "[smoke-prod] WARN: ORCHESTRATOR_API_KEY not set in env; skipping authenticated round-trip check." >&2
else
  # curl -w '%{http_code}' always prints something (000 on connect failure),
  # so don't double-up with `|| echo` — that produces "000000" which is ugly.
  status=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Origin: $SPA_URL" \
    -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
    --connect-timeout 5 \
    "$ORCHESTRATOR_BASE_URL/v1/agents" 2>/dev/null)
  status="${status:-000}"
  if [ "$status" = "200" ]; then
    say_ok "Authenticated GET /v1/agents returned 200."
  else
    say_fail "Authenticated GET /v1/agents returned $status (expected 200; orchestrator may not recognize ORCHESTRATOR_API_KEY, or the path is wrong)."
  fi
fi

if [ "$FAIL" -ne 0 ]; then
  echo "[smoke-prod] One or more checks failed. See messages above." >&2
  exit 1
fi
echo "[smoke-prod] All checks passed."
