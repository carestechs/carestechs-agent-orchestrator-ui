# Implementation Plan: T-033 — Refactor Playwright e2e for the direct-call topology

## Task Reference
- **Task ID:** T-033
- **Type:** Testing
- **Workflow:** standard
- **Complexity:** M
- **Dependencies:** T-032 (BFF deleted; SPA must talk to upstream mock directly)
- **Rationale:** The whole point of FEAT-003 is the new topology; the e2e suite is the only thing that proves it works.

## Overview
The Playwright suite today boots upstream mock + BFF + SPA. After T-032 there's no BFF. Update `playwright.config.ts` to drop the BFF webServer entry, tell the SPA's env file to point at the upstream mock URL, and rewire the `installSecretCapture` helper so it asserts the **new** contract (Authorization header is present, equals the configured key, and doesn't leak elsewhere). Login flow uses the SPA-side passphrase; the on-the-wire login call disappears entirely.

## Implementation Steps

### Step 1: Update `playwright.config.ts`
**File:** `playwright.config.ts`
**Action:** Modify

- Drop the BFF entry from `webServer`. The remaining entry is the SPA static server (or `npm run start` for the dev server, depending on which the e2e currently uses).
- The SPA static server (`scripts/serve-spa.mjs` after T-032's rename) needs to know the orchestrator URL to bake into the bundle. **Two options:**
  - **(a)** Build the SPA with the upstream-mock URL baked in via `environment.prod.ts` populated from CI env. Simplest.
  - **(b)** Hand `ORCHESTRATOR_BASE_URL` to the SPA via a `/config.json` runtime fetch. Requires the runtime-config decision we explicitly didn't take in the FEAT brief — skip.
- Recommended: option (a). The e2e CI step builds the SPA fresh after writing `src/environments/environment.prod.ts` with `orchestratorBaseUrl: 'http://127.0.0.1:4100'`, `orchestratorApiKey: 'test-key-do-not-leak'`, `operatorPassphrase: 'e2e-passphrase'`.
- For local dev, `npm run dev` reads from `environment.ts`; developers populate it from the example.
- Keep `globalSetup`, `workers: 1`, `forbidOnly` etc. unchanged.

```ts
webServer: [
  {
    command: 'npm run lhci:serve', // serves dist/spa with SPA fallback
    port: 4200,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
],
```

### Step 2: Bake the env file before e2e
**Files:** `e2e/global-setup.ts`, `package.json`
**Action:** Modify

`e2e/global-setup.ts` already starts the upstream mock on a fixed port (4100). Add a write step that materializes `src/environments/environment.ts` (and `.prod.ts`) from a constant inside `global-setup.ts` before tests run:

```ts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const E2E_ENV = `
import type { EnvironmentConfig } from './environment.example';
export const environment: EnvironmentConfig = {
  production: false,
  orchestratorBaseUrl: 'http://127.0.0.1:4100',
  orchestratorApiKey: 'test-key-do-not-leak',
  operatorPassphrase: 'e2e-passphrase',
};
`;

// Inside globalSetup, before mock.start():
writeFileSync(resolve(__dirname, '../src/environments/environment.ts'), E2E_ENV);
writeFileSync(resolve(__dirname, '../src/environments/environment.prod.ts'), E2E_ENV);
```

- This runs before the SPA's `webServer` boots, so the SPA dev server (or rebuild) picks up the e2e values.
- For CI: add an `npm run build` step before the Playwright run if the e2e uses the static server (which serves `dist/`).
- The written files are gitignored; this is safe as long as developers don't commit them after a failed e2e.

### Step 3: Invert the secret-capture helper
**File:** `e2e/critical-path.spec.ts`
**Action:** Modify

The helper currently asserts no `Authorization` header on browser-issued requests. After T-030 every request has one. New shape:

```ts
function installSecretCapture(page: Page): {
  authHeaderPresentCount: number;
  unexpectedKeyExposureURLs: CapturedRequest[];
} {
  let authHeaderPresentCount = 0;
  const unexpectedKeyExposureURLs: CapturedRequest[] = [];
  page.on('request', (req) => {
    const auth = req.headers()['authorization'];
    if (auth === `Bearer ${E2E_API_KEY}`) {
      authHeaderPresentCount += 1;
    }
    // The API key value MUST NOT appear in URLs or non-Authorization headers.
    if (req.url().includes(E2E_API_KEY)) {
      unexpectedKeyExposureURLs.push({ method: req.method(), url: req.url() });
    }
    // The passphrase MUST NEVER leave the browser. If it appears anywhere,
    // that's a leak.
    const body = req.postData();
    if (req.url().includes(E2E_PASSPHRASE) || (body && body.includes(E2E_PASSPHRASE))) {
      unexpectedKeyExposureURLs.push({ method: req.method(), url: req.url() });
    }
  });
  return { authHeaderPresentCount, unexpectedKeyExposureURLs };
}
```

Update assertions in `critical-path.spec.ts`:
- `expect(capture.authHeaderPresentCount).toBeGreaterThan(0)` — at least one request actually carried the header.
- `expect(capture.unexpectedKeyExposureURLs).toEqual([])` — neither the API key (in non-Authorization positions) nor the passphrase ever leaked.

The old "no Authorization header" assertion goes away.

### Step 4: Update login flow in every spec
**Files:** `e2e/critical-path.spec.ts`, `e2e/cancel-run.spec.ts`, `e2e/start-run.spec.ts`
**Action:** Modify

The selectors `[data-testid="login-passphrase"]` and `[data-testid="login-submit"]` survive. The behavior survives. The only difference: there's no network request fired by the login button anymore. Tests should still work as-is; verify by running each spec.

If any spec waits for a specific `/auth/login` request via `page.waitForResponse(...)`, replace that with `page.waitForURL(...)` against the post-login destination.

### Step 5: Path-prefix migration in the upstream mock — already correct
**File:** `e2e/fixtures/upstream-mock.ts`
**Action:** Verify (no change expected)

The mock listens on `/v1/*` already (it doesn't carry the `/api/` prefix — the BFF used to translate). After T-030, the SPA hits `/v1/*` directly, so the mock's existing route table aligns. Confirm with a single grep.

### Step 6: Drop the BFF static server proxy paths from the SPA static server's lhci config
**File:** `scripts/serve-spa.mjs` (after T-032's rename)
**Action:** Verify (no change expected if T-032 already gutted it)

The static server should now only serve static files with SPA fallback. No `/api` or `/auth` proxy. Confirm.

### Step 7: Three-run flake check
**Action:** Verify

Run `npm run e2e` three consecutive times locally. Acceptance is no flake across 3.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `playwright.config.ts` | Modify | Drop BFF webServer entry. |
| `e2e/global-setup.ts` | Modify | Materialize env files for the e2e run. |
| `e2e/critical-path.spec.ts` | Modify | Invert secret capture; new positive assertions. |
| `e2e/cancel-run.spec.ts` | Modify | Verify login flow still works without backend call. |
| `e2e/start-run.spec.ts` | Modify | Same. |
| `e2e/fixtures/upstream-mock.ts` | Verify | No change expected — paths already `/v1/*`. |
| `package.json` | Modify | If e2e CI step needs an explicit build, add it. |

## Edge Cases & Risks
- **Materializing env files at e2e time vs. committing them.** Materializing in `global-setup.ts` keeps real env files out of the repo while letting the e2e bake known values into the bundle. This is the right tradeoff for an interim posture.
- **CORS in tests.** The upstream mock currently doesn't set `Access-Control-Allow-Origin`. With direct calls from the SPA at `localhost:4200` to the mock at `127.0.0.1:4100`, CORS preflight will fire. Update the mock to respond with `Access-Control-Allow-Origin: http://localhost:4200`, `Access-Control-Allow-Headers: authorization, content-type`, `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE`. Also handle `OPTIONS` requests with a 204.
- **Test data isolation.** `__test/reset` continues to work the same way; the SPA hits it via the mock's URL directly.
- **Stale `dist/` between e2e runs.** If the e2e flow uses `lhci:serve` (which serves `dist/spa/browser/`), and we change env files between local runs, a stale build will serve old values. The `e2e/global-setup.ts` step should rewrite the env files **and** the CI step should rebuild before serving. Document this in the PR.

## Acceptance Verification
- [ ] Playwright config boots only the SPA static server. No BFF entry.
- [ ] All three specs (`critical-path`, `cancel-run`, `start-run`) pass.
- [ ] `installSecretCapture` asserts Authorization header IS present and matches the configured key; asserts neither the key (off-channel) nor the passphrase leaks.
- [ ] No spec references `/auth/*` or asserts a `/auth/login` request.
- [ ] Three consecutive local runs are clean.
