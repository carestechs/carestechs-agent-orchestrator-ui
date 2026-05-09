# Implementation Plan: T-022 — Verify no API key in browser bundle or network traffic

## Task Reference
- **Task ID:** T-022
- **Type:** Testing
- **Workflow:** standard
- **Complexity:** S
- **Rationale:** The "no API key in browser" AC is security-critical. Reviews miss accidents (a stray `console.log`, an env import that leaks); a mechanical gate at build time plus a runtime assertion in the E2E suite catches both static and dynamic leaks. Per `CLAUDE.md` BFF section ("Never log the orchestrator API key") and Anti-Patterns ("Don't ship the API key to the browser").

## Overview
Add two complementary checks. First, a `postbuild` shell script greps the SPA's `dist/` output for the literal value of `ORCHESTRATOR_API_KEY` (read from env at script invocation, never written to disk) and for any literal `Authorization: Bearer` string — it exits non-zero if either is found, but it never prints the key value, only the offending file path and line numbers. Second, the Playwright critical-path spec from T-020 captures every browser-initiated request and asserts none of them carry an `Authorization` header.

## Implementation Steps

### Step 1: Author the bundle scan script
**File:** `scripts/check-no-secrets-in-bundle.sh`
**Action:** Create
POSIX shell script (bash). Behavior:

```sh
#!/usr/bin/env bash
set -euo pipefail

DIST_DIR="${DIST_DIR:-dist}"

if [ -z "${ORCHESTRATOR_API_KEY:-}" ]; then
  echo "[check-no-secrets] ORCHESTRATOR_API_KEY not set; skipping value-scan." >&2
  echo "[check-no-secrets] (Authorization-literal scan still runs.)" >&2
  SKIP_KEY_SCAN=1
else
  SKIP_KEY_SCAN=0
fi

FAIL=0

# Scan 1: literal API key value. NEVER print the matched value.
if [ "$SKIP_KEY_SCAN" -eq 0 ]; then
  # grep -rn returns "<file>:<lineno>:<line>"; we only want file:lineno.
  MATCHES=$(grep -rnFI --include='*.js' --include='*.css' --include='*.html' --include='*.map' \
    -e "$ORCHESTRATOR_API_KEY" "$DIST_DIR" 2>/dev/null | cut -d: -f1,2 || true)
  if [ -n "$MATCHES" ]; then
    echo "[check-no-secrets] FAIL: orchestrator API key value found in build output:" >&2
    echo "$MATCHES" >&2
    FAIL=1
  fi
fi

# Scan 2: literal "Authorization: Bearer". Safe to print the matched line.
AUTH_MATCHES=$(grep -rniI --include='*.js' --include='*.css' --include='*.html' --include='*.map' \
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
```

Critical rules per task brief:
- **Never print the key value on failure.** The first scan uses `cut -d: -f1,2` to discard the line content, leaving only `path:lineno`. The literal value never appears in CI logs.
- The second scan (Authorization literal) is allowed to print the line, since the literal string `Authorization: Bearer` carries no secret.
- `grep -F` for the value scan (literal, not regex) — the key may contain regex meta-characters; `-F` avoids false negatives.
- `--include` filters to web-shippable artifacts; restrict to the SPA output dir, not the BFF's `dist/` (the BFF is a server, not a browser asset). If the build outputs both under one `dist/`, set `DIST_DIR` to the SPA subpath in `package.json` (Step 2).
- `chmod +x` after creation.

### Step 2: Wire the script into `postbuild`
**File:** `package.json`
**Action:** Modify
Add:

```jsonc
{
  "scripts": {
    "postbuild": "scripts/check-no-secrets-in-bundle.sh",
    "check:no-secrets": "scripts/check-no-secrets-in-bundle.sh"
  }
}
```

`postbuild` runs automatically after `npm run build` (per npm lifecycle), so any local or CI build that completes also passes the secret scan or fails the build. The standalone `check:no-secrets` alias makes ad-hoc runs explicit.

If the build outputs the SPA to a non-default subpath (e.g. `dist/agent-orchestrator-ui/`), set `DIST_DIR` in the script entry: `"postbuild": "DIST_DIR=dist/agent-orchestrator-ui scripts/check-no-secrets-in-bundle.sh"`. Read `angular.json` `projects.<name>.architect.build.options.outputPath` at implementation time to fill this in.

### Step 3: Augment the Playwright critical-path spec with the Authorization-header assertion
**File:** `e2e/critical-path.spec.ts`
**Action:** Modify
Depends on T-020 Step 5 (the spec must already exist). The browser-side capture is already added in T-020 Step 5 item 1 — this step makes the assertion explicit and adds the additional value-leak check:

```ts
const seenAuthHeaders: Array<{ method: string; url: string }> = [];
const seenKeyLeak: Array<{ method: string; url: string }> = [];
const KEY = process.env.E2E_API_KEY ?? 'test-key-do-not-leak';

page.on('request', (req) => {
  const auth = req.headers()['authorization'];
  if (auth !== undefined) {
    seenAuthHeaders.push({ method: req.method(), url: req.url() });
  }
  // Defense in depth: scan body and URL for the literal key value.
  const body = req.postData();
  if (req.url().includes(KEY) || (body && body.includes(KEY))) {
    seenKeyLeak.push({ method: req.method(), url: req.url() });
  }
});

// ... the rest of the test runs ...

// At the end of the test:
expect(seenAuthHeaders, 'no browser request should carry Authorization').toEqual([]);
expect(seenKeyLeak, 'no browser request should contain the API key value').toEqual([]);
```

Notes:
- Failure messages do NOT print the key value; they print the offending request method+URL. Same discipline as the bundle scanner.
- The test value `test-key-do-not-leak` matches the env passed by T-020's Playwright config and T-021's CI workflow — keeping the seed the same simplifies multi-suite assertions.
- `request.headers()['authorization']` returns lowercase keys per the Playwright API; do not mix-case probe.

### Step 4: Document the CI invocation
**File:** *(no new file)*
**Action:** Verify
Confirm CI runs `npm run build` (which triggers `postbuild`) before any artifact upload or deploy. If T-021's workflow (`lighthouse.yml`) or any future deploy workflow runs `npm run build` with `ORCHESTRATOR_API_KEY` exported, the scan runs automatically. **In the lighthouse workflow specifically**, the scan must run with the same key value the BFF received — i.e. set `ORCHESTRATOR_API_KEY=test-key-do-not-leak` in the workflow env before `npm run build`. (This is already the env the BFF uses per T-021 Step 4 step 6 — same variable, same value.)

If a CI build job exists without `ORCHESTRATOR_API_KEY` exported, the script will skip the value scan and only run the Authorization-literal scan. That is acceptable but logged with a warning so reviewers know the deeper check did not run.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `scripts/check-no-secrets-in-bundle.sh` | Create | Greps `dist/` for the API key value (path:lineno only) and any `Authorization: Bearer` literal; exits non-zero on match. |
| `package.json` | Modify | Add `postbuild` and `check:no-secrets` scripts pointing at the scanner. |
| `e2e/critical-path.spec.ts` | Modify | Make the no-`Authorization`-header assertion explicit; add API-key-value leak check on every captured request body/URL. |

## Edge Cases & Risks
- **Source maps leaking the key.** If a developer accidentally hardcodes the key into a TS file and the build emits sourcemaps, the value would appear in `*.map` files. The scanner includes `*.map` in its `--include` set to catch this.
- **Key value too short.** If `ORCHESTRATOR_API_KEY` is set to a short test string like `x`, the scanner would match every JS file containing the letter `x` after minification. Mitigation: in CI, use a high-entropy test value (the `test-key-do-not-leak` literal is unique enough; production keys are long enough to be safe). Document a minimum length in the script's header comment if desired (do not add a runtime check — that constrains operators).
- **Unicode normalization.** Bundlers don't normalize string literals, so `grep -F` on the raw bytes is exact. No risk.
- **`postbuild` fires for every build, including dev builds without `ORCHESTRATOR_API_KEY`.** Handled by the env-presence check at the top of the script — the scanner skips the value scan with a stderr warning rather than failing. The Authorization-literal scan still runs, since it doesn't depend on the env.
- **False positives in `*.map` files referencing the key from a comment.** Unlikely (the key has no business in source comments), but if it happens, the developer must remove the comment, not exception-list the file.
- **Browser-side false negative if the SPA fetched a third-party origin that echoed the key.** No third-party origins are used in v1 (BFF is the only data origin); revisit if SDKs are added later.
- **Authorization literal in third-party libs.** `Authorization: Bearer` strings sometimes appear in vendor libraries' docstrings or examples that survive minification. If a real false positive surfaces, switch to a stricter regex (`Authorization[[:space:]]*:[[:space:]]*Bearer[[:space:]]+[A-Za-z0-9._-]{8,}`) or exception-list the specific library file path.
- **Depends partly on T-020.** Step 3 modifies the spec authored in T-020; this plan must be implemented after T-020's `e2e/critical-path.spec.ts` exists. T-020 already includes the capture scaffolding to keep the dependency narrow (T-022 only formalizes the assertions).

## Acceptance Verification
- [ ] AC "CI step grep-fails the build if `ORCHESTRATOR_API_KEY` value is found in any `dist/**/*.js`" — verified by Step 1 (`scripts/check-no-secrets-in-bundle.sh` Scan 1) and Step 2 (`postbuild` wiring runs automatically after `npm run build`). The script exits non-zero on match, failing the build; the matched value is never printed (only `path:lineno`).
- [ ] AC "Playwright spec asserts `request.headers.authorization` is absent on every captured browser request" — verified by Step 3's explicit `expect(seenAuthHeaders).toEqual([])` assertion in `e2e/critical-path.spec.ts`, with the capture installed before `page.goto` so it observes every request from page load through teardown.
