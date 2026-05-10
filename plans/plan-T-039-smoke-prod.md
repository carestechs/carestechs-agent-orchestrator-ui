# Implementation Plan: T-039 — Operator smoke script (readiness probe)

## Task Reference
- **Task ID:** T-039
- **Type:** DevOps / verification
- **Workflow:** standard
- **Complexity:** S
- **Dependencies:** T-038 (compose stack runs)
- **Rationale:** The docker `HEALTHCHECK` proves liveness, not readiness. Operators need a one-line command that catches a silent CORS misconfiguration.

## Overview
Author `scripts/smoke-prod.sh` — an operator-run script that hits the SPA's index, verifies the bundle was built with the right orchestrator URL, then exercises CORS preflight and an authenticated request against the orchestrator. Exit 0 only if all four checks pass; print a single actionable line per failure.

## Implementation Steps

### Step 1: Create the script
**File:** `scripts/smoke-prod.sh`
**Action:** Create

```bash
#!/usr/bin/env bash
# Post-deploy smoke. Run after `docker compose -f docker-compose.prod.yml up -d`.
# Verifies the SPA container is serving the bundle AND that CORS / auth round-
# trips to the orchestrator actually work (the docker HEALTHCHECK only proves
# nginx is up).
set -euo pipefail

SPA_URL="${SPA_URL:-http://127.0.0.1:4200}"
ORCHESTRATOR_BASE_URL="${ORCHESTRATOR_BASE_URL:-http://127.0.0.1:8000}"
ORCHESTRATOR_API_KEY="${ORCHESTRATOR_API_KEY:-}"

FAIL=0
say_fail() { echo "[smoke-prod] FAIL: $1" >&2; FAIL=1; }
say_ok()   { echo "[smoke-prod] OK:   $1"; }

# 1. SPA index reachable and contains <app-root>.
index=$(curl -s "$SPA_URL/" || true)
if echo "$index" | grep -q '<app-root'; then
  say_ok "SPA index served at $SPA_URL/."
else
  say_fail "SPA index not reachable or missing <app-root> at $SPA_URL/ (is the container running? \`docker compose -f docker-compose.prod.yml ps\`)."
fi

# 2. Bundle was built with the expected orchestrator URL.
#    Fetch the bundle list from the index, grep each chunk for the URL.
chunks=$(echo "$index" | grep -oE '"[^"]*\.js"' | tr -d '"' | head -20)
found_url=0
for chunk in $chunks; do
  url="$SPA_URL/$chunk"
  if curl -s "$url" | grep -qF "$ORCHESTRATOR_BASE_URL"; then
    found_url=1
    break
  fi
done
if [ "$found_url" -eq 1 ]; then
  say_ok "Bundle contains ORCHESTRATOR_BASE_URL ($ORCHESTRATOR_BASE_URL)."
else
  say_fail "Bundle does not contain ORCHESTRATOR_BASE_URL ($ORCHESTRATOR_BASE_URL) — was the container built with the right --build-arg? (\`docker compose up --build\`)"
fi

# 3. CORS preflight from the SPA's origin succeeds.
hdr=$(curl -s -o /dev/null -D - -X OPTIONS \
  -H "Origin: $SPA_URL" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" \
  "$ORCHESTRATOR_BASE_URL/v1/agents" | tr -d '\r')
if echo "$hdr" | grep -qi "^access-control-allow-origin:.*$SPA_URL"; then
  say_ok "CORS preflight from $SPA_URL passes."
else
  say_fail "CORS preflight from $SPA_URL failed (orchestrator must allow this origin and 'authorization' header — run scripts/check-orchestrator-cors.sh for details)."
fi

# 4. Authenticated GET /v1/agents succeeds.
if [ -z "$ORCHESTRATOR_API_KEY" ]; then
  echo "[smoke-prod] WARN: ORCHESTRATOR_API_KEY not set in env; skipping authenticated round-trip check." >&2
else
  status=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Origin: $SPA_URL" \
    -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
    "$ORCHESTRATOR_BASE_URL/v1/agents")
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
```

### Step 2: `chmod +x`
**Action:** `chmod +x scripts/smoke-prod.sh`

### Step 3: Local smoke against the e2e mock
**Action:** Verify

- Build the container with `ORCHESTRATOR_BASE_URL=http://127.0.0.1:4100`, run via compose.
- In another shell, `npm run upstream-mock`.
- Run: `SPA_URL=http://127.0.0.1:4200 ORCHESTRATOR_BASE_URL=http://127.0.0.1:4100 ORCHESTRATOR_API_KEY=test-key-do-not-leak scripts/smoke-prod.sh`.
- All four checks should pass.
- Test the failure paths:
  - Wrong API key → check 4 fails with a 401.
  - Wrong `ORCHESTRATOR_BASE_URL` in env (mismatched against the bundle) → check 2 fails.
  - Container stopped → check 1 fails.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `scripts/smoke-prod.sh` | Create | Four-check operator smoke: SPA index, bundle URL, CORS preflight, authenticated GET. |

## Edge Cases & Risks
- **The bundle-URL grep matches false positives** if the operator's orchestrator URL happens to be a substring of something else in the bundle (e.g., a documentation comment). Unlikely; if it bites, tighten to a regex anchored on `"http`.
- **The script does not validate the trace endpoint** specifically. T-036's CORS-check script covers that. Don't duplicate.
- **`ORCHESTRATOR_API_KEY` shell-leak.** The script reads it from env, doesn't print it. But operators may have it in their shell history. Worth a one-line comment in the script header. Not adding more friction (e.g., a prompt) — operators run this script often enough that prompts would be annoying.
- **404 from `/v1/agents`** is theoretically possible if the orchestrator has zero agents registered — but the response is still 200 with `data: []`. If a future orchestrator change makes it 404, swap to `/v1/runs?pageSize=1` which is always available.
- **Script lives in `scripts/`.** Documented in `CLAUDE.md` (T-040) as the post-deploy verification step.

## Acceptance Verification
- [ ] `scripts/smoke-prod.sh` is executable.
- [ ] All four checks pass when run against a healthy stack (container up + e2e mock running with matching values).
- [ ] Each failure mode prints a specific, actionable message naming what to fix.
- [ ] The script reads all inputs from env, never accepts secrets on the command line.
- [ ] T-040's `CLAUDE.md` update names this as the post-`up` verification step.
