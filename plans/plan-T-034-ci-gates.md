# Implementation Plan: T-034 — Invert the bundle-leak CI gate; simplify the Lighthouse workflow

## Task Reference
- **Task ID:** T-034
- **Type:** DevOps
- **Workflow:** standard
- **Complexity:** S
- **Dependencies:** T-030 (API key now in bundle), T-032 (BFF gone)
- **Rationale:** The bundle-leak inversion is load-bearing — without it the gate fails on every PR after T-030. The Lighthouse simplification is a free-rider since the workflow file is already being touched.

## Overview
Two changes ride together:

1. **`scripts/check-no-secrets-in-bundle.sh`** — flip from "API key value forbidden in bundle" to "passphrase value forbidden in bundle." API key is now expected. Drop the `Authorization: Bearer` literal scan (also expected now).
2. **`.github/workflows/lighthouse.yml`** — drop the BFF boot block, drop BFF env vars (`SESSION_SECRET`, `ORCHESTRATOR_OPERATOR_PASSPHRASE`), drop the `/auth/me` wait-on probe.

## Implementation Steps

### Step 1: Invert the bundle-leak script
**File:** `scripts/check-no-secrets-in-bundle.sh`
**Action:** Modify

Rewrite assertions:

```bash
#!/usr/bin/env bash
# Scans the SPA bundle for accidental leaks of secrets that should NEVER ship
# to the browser. After FEAT-003, the orchestrator API key IS in the bundle by
# design (network-gated deployment); this gate guards against everything else.
#
# Forbidden in bundle:
#   - OPERATOR_PASSPHRASE value (knows-your-passphrase != network-gated)
#   - Any explicit "session" / "secret" placeholder strings if env-set
#
# Allowed:
#   - ORCHESTRATOR_API_KEY value
#   - "Authorization: Bearer ..." literal (the SPA constructs this header)
set -euo pipefail

DIST_DIR="${DIST_DIR:-dist/spa/browser}"

if [ ! -d "$DIST_DIR" ]; then
  echo "[check-no-secrets] $DIST_DIR does not exist; skipping (run after a build)." >&2
  exit 0
fi

FAIL=0

scan_forbidden() {
  local label="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "[check-no-secrets] $label not set in env; skipping." >&2
    return
  fi
  local matches
  matches=$(grep -rnFI \
    --include='*.js' --include='*.css' --include='*.html' --include='*.map' \
    -e "$value" "$DIST_DIR" 2>/dev/null | cut -d: -f1,2 || true)
  if [ -n "$matches" ]; then
    echo "[check-no-secrets] FAIL: $label value found in bundle (path:lineno only):" >&2
    echo "$matches" >&2
    FAIL=1
  fi
}

scan_forbidden 'OPERATOR_PASSPHRASE' "${OPERATOR_PASSPHRASE:-}"
# Add more forbidden values here as new secrets enter env (one line each).

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "[check-no-secrets] OK: no forbidden values in $DIST_DIR."
```

- Drop the `Authorization: Bearer` literal scan entirely. Drop the API-key value scan.
- Add a one-line comment explaining how to extend the allow-list ("add a `scan_forbidden` line per new secret").
- The `OPERATOR_PASSPHRASE` env var name parallels the BFF era's `ORCHESTRATOR_OPERATOR_PASSPHRASE`; pick whichever name CI is set up to inject and match it.

### Step 2: Smoke the script locally
**Action:** Verify

```bash
# Build with placeholder env
cp src/environments/environment.example.ts src/environments/environment.ts
cp src/environments/environment.example.ts src/environments/environment.prod.ts
npm run build
# Should pass — no OPERATOR_PASSPHRASE forbidden value in env, so just prints "skipping"
OPERATOR_PASSPHRASE=replace-me ./scripts/check-no-secrets-in-bundle.sh
# Should FAIL — passphrase is in the bundle (it's in environment.prod.ts → bundled)
```

The second invocation should fail loud — confirming the gate actually fires when something forbidden lands in the bundle. This is the regression-prevention test.

### Step 3: Simplify the Lighthouse workflow
**File:** `.github/workflows/lighthouse.yml`
**Action:** Modify

Remove from the `Boot stack and wait for readiness` step:
- The `nohup node --import tsx bff/src/server.ts ...` block.
- The `wait-on http-get://localhost:4000/auth/me` line.
- The `/tmp/bff.pid` file handling and the matching `kill` in the cleanup step.

Remove from the `env:` block at the top of the job:
- `ORCHESTRATOR_OPERATOR_PASSPHRASE` (now baked into the SPA env file at build time).
- `SESSION_SECRET` (no session).
- `ORCHESTRATOR_BASE_URL` (now baked into the SPA env file).

Add (or repurpose) a step before `Build SPA + BFF`:

```yaml
- name: Materialize SPA env file for CI
  run: |
    cat > src/environments/environment.prod.ts <<'EOF'
    import type { EnvironmentConfig } from './environment.example';
    export const environment: EnvironmentConfig = {
      production: true,
      orchestratorBaseUrl: 'http://127.0.0.1:4100',
      orchestratorApiKey: '${{ env.ORCHESTRATOR_API_KEY }}',
      operatorPassphrase: '${{ env.OPERATOR_PASSPHRASE }}',
    };
    EOF
```

(Or use `printf` / a heredoc that doesn't expand `${{ }}` inside YAML — adjust to whatever GitHub Actions syntax actually does.)

Rename the build step from `Build SPA + BFF` to `Build SPA`. Drop the BFF tsc step that's already gone.

Update the `Show service logs on failure` step to drop the `/tmp/lhci-logs/bff.log` cat.

### Step 4: Update the puppeteer login script if needed
**File:** `scripts/lhci-puppeteer-login.js`
**Action:** Verify (likely no change)

The script types into `[data-testid="login-passphrase"]` and clicks `[data-testid="login-submit"]`. After T-031 those selectors still exist; the click no longer triggers a network call but `Promise.all([waitForNavigation(...), click(...)])` still works because the SPA navigates internally on a successful gate check.

If `waitForNavigation` times out (because there's no network round-trip and Angular's router uses `pushState`, not full navigation), replace with:

```js
await Promise.all([
  page.waitForResponse(() => true, { timeout: 1000 }).catch(() => undefined),
  page.click('[data-testid="login-submit"]'),
]);
```

…or simpler:

```js
await page.click('[data-testid="login-submit"]');
await page.waitForFunction(() => !location.pathname.endsWith('/login'), { timeout: 5000 });
```

Test locally before locking this in.

### Step 5: Smoke
**Action:** Verify

- `npm run build` succeeds.
- `OPERATOR_PASSPHRASE=<the-value> scripts/check-no-secrets-in-bundle.sh` correctly fails.
- Run lhci locally end-to-end (same recipe as FEAT-002 T-028) and confirm all four URL scores ≥ 0.95.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `scripts/check-no-secrets-in-bundle.sh` | Modify | Forbid passphrase value; drop API-key/Authorization scans. |
| `.github/workflows/lighthouse.yml` | Modify | Drop BFF boot/env/wait-on; add env-file materialize step; rename build step. |
| `scripts/lhci-puppeteer-login.js` | Verify | Possibly swap `waitForNavigation` for `waitForFunction` if needed. |

## Edge Cases & Risks
- **CI env var naming.** The current workflow uses `ORCHESTRATOR_OPERATOR_PASSPHRASE`. The script's new check uses `OPERATOR_PASSPHRASE`. Pick one and align both. Recommend `OPERATOR_PASSPHRASE` (drop the prefix; the orchestrator no longer owns this gate).
- **Heredoc + GitHub Actions expansion.** `${{ }}` inside a heredoc expands at workflow-render time; safe. But quoted single-quotes around the heredoc tag (`<<'EOF'`) suppress shell expansion which is what we want for the literal env-file content. Make sure the syntax actually works on the runner before merging.
- **The bundle-leak gate's false negatives.** If the passphrase is short and common (e.g., "password"), the scan can false-positive against Angular's own runtime that mentions the word. Pick a long-ish passphrase in production, or add a comment in the script saying "passphrase must be ≥ 16 chars to keep the scanner reliable."
- **Local DX.** Developers don't typically have `OPERATOR_PASSPHRASE` in their shell; the script prints "skipping" and returns 0. Document this in the script's comment so the message isn't alarming.

## Acceptance Verification
- [ ] `scripts/check-no-secrets-in-bundle.sh` passes when given a bundle containing the API key.
- [ ] The same script fails loud when given a bundle containing the passphrase value (smoke test in Step 2).
- [ ] `.github/workflows/lighthouse.yml` boots only `upstream-mock` + SPA static server; `/auth/me` wait-on is gone; BFF env vars are gone.
- [ ] Local lhci run produces all four URL scores ≥ 0.95.
- [ ] CI Lighthouse workflow on the PR is green.
