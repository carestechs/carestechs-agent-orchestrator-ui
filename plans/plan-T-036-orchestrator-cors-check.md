# Implementation Plan: T-036 — Verify orchestrator CORS for the operator-local origin

## Task Reference
- **Task ID:** T-036
- **Type:** DevOps / verification
- **Workflow:** standard
- **Complexity:** S
- **Dependencies:** None
- **Rationale:** Hard gate before any container work. A 5-minute curl prevents a Saturday of debugging.

## Overview
Author `scripts/check-orchestrator-cors.sh` — a self-contained shell script that issues three curl-based preflight checks against the deployed orchestrator and exits non-zero on any failure. Each failure mode names exactly which header / method / endpoint is wrong, so the orchestrator team has a single piece of paper to act on.

## Implementation Steps

### Step 1: Create the script
**File:** `scripts/check-orchestrator-cors.sh`
**Action:** Create

```bash
#!/usr/bin/env bash
# Verifies the orchestrator's CORS posture for the operator-local SPA origin.
# Run before any FEAT-005 container work, and again on every orchestrator
# deployment topology change.
set -euo pipefail

ORIGIN="${SPA_ORIGIN:-http://127.0.0.1:4200}"
BASE="${ORCHESTRATOR_BASE_URL:-http://127.0.0.1:8000}"

FAIL=0
say_fail() { echo "[cors-check] FAIL: $1" >&2; FAIL=1; }
say_ok()   { echo "[cors-check] OK:   $1"; }

# 1. Simple GET preflight: confirm Access-Control-Allow-Origin echoes our origin.
hdr=$(curl -s -o /dev/null -D - -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  "$BASE/v1/agents" | tr -d '\r')
echo "$hdr" | grep -qi "^access-control-allow-origin:.*$ORIGIN" \
  || say_fail "OPTIONS /v1/agents — Access-Control-Allow-Origin does not allow $ORIGIN (set it on the orchestrator)."
say_ok "OPTIONS /v1/agents allows origin $ORIGIN."

# 2. POST preflight with content-type + authorization: confirm both headers are allowed.
hdr=$(curl -s -o /dev/null -D - -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  "$BASE/v1/runs" | tr -d '\r')
echo "$hdr" | grep -qi "^access-control-allow-headers:.*authorization" \
  || say_fail "OPTIONS /v1/runs — Access-Control-Allow-Headers missing 'authorization' (add it on the orchestrator)."
echo "$hdr" | grep -qi "^access-control-allow-headers:.*content-type" \
  || say_fail "OPTIONS /v1/runs — Access-Control-Allow-Headers missing 'content-type' (add it on the orchestrator)."
say_ok "OPTIONS /v1/runs allows authorization + content-type headers."

# 3. The streaming trace endpoint specifically — most commonly missed.
hdr=$(curl -s -o /dev/null -D - -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" \
  "$BASE/v1/runs/any/trace" | tr -d '\r')
echo "$hdr" | grep -qi "^access-control-allow-origin:.*$ORIGIN" \
  || say_fail "OPTIONS /v1/runs/:id/trace — Access-Control-Allow-Origin missing (streaming endpoint often missed)."
say_ok "OPTIONS /v1/runs/:id/trace preflight passes."

if [ "$FAIL" -ne 0 ]; then
  echo "[cors-check] One or more CORS preflight checks failed. Fix at the orchestrator before continuing with FEAT-005." >&2
  exit 1
fi
echo "[cors-check] CORS posture acceptable for FEAT-005."
```

### Step 2: Make it executable
**Action:** `chmod +x scripts/check-orchestrator-cors.sh`

### Step 3: Smoke against the in-process e2e mock locally
**Action:** Verify

- Start the e2e upstream mock: `npm run upstream-mock` (in another shell).
- Run: `SPA_ORIGIN=http://localhost:4200 ORCHESTRATOR_BASE_URL=http://127.0.0.1:4100 scripts/check-orchestrator-cors.sh`.
- Should pass — the e2e mock already echoes Origin and allows `authorization, content-type` (it does this since FEAT-003 T-030).
- This confirms the script's logic. The real verification happens against the deployed orchestrator on the operator's machine.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `scripts/check-orchestrator-cors.sh` | Create | Three curl-based preflight checks; exits non-zero with a specific message per failure. |

## Edge Cases & Risks
- **Orchestrator answers 405 to OPTIONS** instead of 204. Some CORS implementations are picky; the script should still parse the headers from a non-2xx response. The current shape (`curl -s -o /dev/null -D -`) prints headers regardless of status.
- **Preflight cache.** If a previous good preflight is cached by the orchestrator's CDN, a regression could go undetected briefly. The script doesn't try to bust caches — operators re-run it after deployment changes. Worth a comment.
- **`Access-Control-Allow-Origin: *`** is technically a passing match for the `grep` here. That's intentional — the orchestrator may legitimately use wildcard for the network-gated deployment. If we ever need to forbid wildcard (e.g., for credentialed requests), tighten the grep to require an exact match.
- **The streaming endpoint's preflight is the load-bearing check.** If only one of the three checks could be kept, it would be this one — it's the most commonly missed.

## Acceptance Verification
- [ ] `scripts/check-orchestrator-cors.sh` is executable and self-contained (no external deps beyond curl).
- [ ] Running against the e2e mock (`ORCHESTRATOR_BASE_URL=http://127.0.0.1:4100`) returns "CORS posture acceptable for FEAT-005."
- [ ] Running against a misconfigured orchestrator (e.g., omitting `Access-Control-Allow-Headers`) fails loud and names the specific header.
- [ ] T-040's doc surgery includes a "run this after every orchestrator deployment change" pointer to this script.
