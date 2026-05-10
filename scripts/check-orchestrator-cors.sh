#!/usr/bin/env bash
# Verifies the orchestrator's CORS posture for the operator-local SPA origin.
# Run before any FEAT-005 container work, and again on every orchestrator
# deployment topology change.
#
# Three checks, each names a single piece of paper the orchestrator team
# would need to act on:
#   1. OPTIONS /v1/agents             — does the orchestrator allow our origin?
#   2. OPTIONS /v1/runs               — are 'authorization' + 'content-type' allowed?
#   3. OPTIONS /v1/runs/any/trace     — does preflight work on the streaming endpoint?
#
# The third is the load-bearing check: CORS for the JSON endpoints often gets
# allowed by reflex, but OPTIONS on /trace is missed because nobody manually
# tests it.
#
# Preflight responses can be cached by upstream CDNs. If a regression is
# suspected, force the CDN to revalidate before re-running.
set -euo pipefail

ORIGIN="${SPA_ORIGIN:-http://127.0.0.1:4200}"
BASE="${ORCHESTRATOR_BASE_URL:-http://127.0.0.1:8000}"

FAIL=0
say_fail() { echo "[cors-check] FAIL: $1" >&2; FAIL=1; }
say_ok()   { echo "[cors-check] OK:   $1"; }

echo "[cors-check] Checking CORS at $BASE for SPA origin $ORIGIN..."

# Each curl is wrapped with `|| true` so a connect failure doesn't trip `set -e`
# before our check logic can name it. Connect failures look like empty header
# strings, which then fall into the same "missing header" FAIL branch.

# 1. Simple GET preflight: confirm Access-Control-Allow-Origin accepts our origin.
hdr=$(curl -s -o /dev/null -D - -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  --connect-timeout 5 \
  "$BASE/v1/agents" 2>/dev/null | tr -d '\r' || true)
if [ -z "$hdr" ]; then
  say_fail "OPTIONS /v1/agents — could not reach $BASE (is the orchestrator running and reachable from this host?)."
fi
if echo "$hdr" | grep -qiE "^access-control-allow-origin:[[:space:]]*(\*|$ORIGIN)"; then
  say_ok "OPTIONS /v1/agents allows origin $ORIGIN."
else
  say_fail "OPTIONS /v1/agents — Access-Control-Allow-Origin does not allow $ORIGIN (set it on the orchestrator)."
fi

# 2. POST preflight with content-type + authorization: confirm both headers are allowed.
hdr=$(curl -s -o /dev/null -D - -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  --connect-timeout 5 \
  "$BASE/v1/runs" 2>/dev/null | tr -d '\r' || true)
if echo "$hdr" | grep -qi "^access-control-allow-headers:.*authorization"; then
  say_ok "OPTIONS /v1/runs allows 'authorization' header."
else
  say_fail "OPTIONS /v1/runs — Access-Control-Allow-Headers missing 'authorization' (add it on the orchestrator)."
fi
if echo "$hdr" | grep -qi "^access-control-allow-headers:.*content-type"; then
  say_ok "OPTIONS /v1/runs allows 'content-type' header."
else
  say_fail "OPTIONS /v1/runs — Access-Control-Allow-Headers missing 'content-type' (add it on the orchestrator)."
fi

# 3. The streaming trace endpoint specifically — most commonly missed.
hdr=$(curl -s -o /dev/null -D - -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" \
  --connect-timeout 5 \
  "$BASE/v1/runs/any/trace" 2>/dev/null | tr -d '\r' || true)
if echo "$hdr" | grep -qiE "^access-control-allow-origin:[[:space:]]*(\*|$ORIGIN)"; then
  say_ok "OPTIONS /v1/runs/:id/trace preflight passes."
else
  say_fail "OPTIONS /v1/runs/:id/trace — Access-Control-Allow-Origin missing (streaming endpoint often missed)."
fi

if [ "$FAIL" -ne 0 ]; then
  echo "[cors-check] One or more CORS preflight checks failed. Fix at the orchestrator before continuing with FEAT-005." >&2
  exit 1
fi
echo "[cors-check] CORS posture acceptable for FEAT-005."
