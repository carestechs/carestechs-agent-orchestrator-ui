# Implementation Plan: T-021 — Lighthouse a11y CI gate ≥ 95 on `/runs` and `/runs/:id`

## Task Reference
- **Task ID:** T-021
- **Type:** Testing
- **Workflow:** standard
- **Complexity:** S
- **Rationale:** Direct AC from FEAT-001 brief — accessibility ≥ 95 on the two operator-critical screens. The gate is mechanical (CI fails the build below threshold) so it cannot rot.

## Overview
Add a Lighthouse CI (`@lhci/cli`) configuration that audits the production build of three routes — `/login`, `/runs`, and `/runs/:id` — and asserts an `accessibility` category score of at least 95 on each. The audit runs against a real server (`http-server` over `dist/`) plus the BFF talking to the same deterministic upstream mock used in T-020, so `/runs/:id` resolves to a real seeded run. A GitHub Actions workflow builds, boots the stack, runs `lhci autorun`, and uploads the HTML report as an artifact for debugging failures.

## Implementation Steps

### Step 1: Add Lighthouse CI configuration
**File:** `lighthouserc.json`
**Action:** Create
Single config covering all three routes:

```json
{
  "ci": {
    "collect": {
      "url": [
        "http://localhost:4200/login",
        "http://localhost:4200/runs",
        "http://localhost:4200/runs/run-e2e-001"
      ],
      "numberOfRuns": 1,
      "settings": {
        "preset": "desktop",
        "onlyCategories": ["accessibility"],
        "chromeFlags": "--no-sandbox --headless=new"
      },
      "puppeteerScript": "./scripts/lhci-puppeteer-login.js",
      "puppeteerLaunchOptions": { "args": ["--no-sandbox"] }
    },
    "assert": {
      "preset": "lighthouse:recommended",
      "assertions": {
        "categories:accessibility": ["error", { "minScore": 0.95 }],
        "categories:performance": "off",
        "categories:best-practices": "off",
        "categories:seo": "off",
        "categories:pwa": "off"
      }
    },
    "upload": {
      "target": "filesystem",
      "outputDir": "./.lighthouseci"
    }
  }
}
```

Notes:
- `onlyCategories: ['accessibility']` plus the `assert` overrides keep the gate narrow — we are deliberately silencing `performance/seo/best-practices/pwa` here because they are not in scope for the FEAT-001 AC. The `assert.preset: lighthouse:recommended` baseline is overridden, not removed, to keep useful a11y sub-rules.
- Threshold `0.95` matches the AC literal "≥ 95".
- The seeded `run-e2e-001` matches the run id used by T-020's upstream mock — same fixture, same id, no duplication.

### Step 2: Add a Puppeteer login helper for authenticated routes
**File:** `scripts/lhci-puppeteer-login.js`
**Action:** Create
Lighthouse CI calls this script before each navigation. It logs in once and persists the session cookie in the shared browser context so `/runs` and `/runs/:id` are reachable. Sketch:

```js
// CommonJS — Lighthouse CI runs this with require()
module.exports = async (browser, context) => {
  // Skip login when auditing /login itself
  if (context.url.endsWith('/login')) return;
  const page = await browser.newPage();
  await page.goto('http://localhost:4200/login');
  await page.type('[data-testid="login-passphrase"]', process.env.E2E_PASSPHRASE || 'e2e-passphrase');
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL('**/runs');
  await page.close();
};
```

This relies on the `data-testid` attributes added in T-020 Step 8 — single source of truth for both Playwright and Lighthouse.

### Step 3: Add an npm script that boots the build, BFF, and upstream mock
**File:** `package.json`
**Action:** Modify
Add scripts:

```jsonc
{
  "scripts": {
    "lhci:serve": "http-server dist/<spa-output-dir> -p 4200 -c-1 --proxy http://localhost:4000?",
    "lhci:run": "lhci autorun"
  }
}
```

Note: the SPA output directory name comes from `angular.json` (`outputPath`); replace `<spa-output-dir>` with the literal path at implementation time. The `--proxy` flag forwards unmatched paths (i.e. `/api`, `/auth`) to the BFF on port 4000, mirroring `proxy.conf.json` in dev. Add `http-server` and `@lhci/cli` to `devDependencies`.

The actual orchestration (start mock + BFF + http-server, run `lhci autorun`, tear down) lives in the workflow (Step 4) — npm scripts stay simple and reusable locally.

### Step 4: Add the GitHub Actions workflow
**File:** `.github/workflows/lighthouse.yml`
**Action:** Create
Workflow steps:

1. `actions/checkout@v4`.
2. `actions/setup-node@v4` with the project's pinned Node version.
3. `npm ci`.
4. `npm run build` — produces `dist/` (SPA + BFF tsc output) per `CLAUDE.md` Quick Reference.
5. **Boot upstream mock** by reusing T-020's fixture: `node -e "import('./e2e/fixtures/upstream-mock.ts').then(...)"` won't work directly with TS — instead, expose a small `scripts/start-upstream-mock.mjs` shim that imports the compiled mock and listens on port 4100. Run it with `&` and capture the PID for cleanup. (See Step 5.)
6. **Boot BFF** with env `ORCHESTRATOR_BASE_URL=http://localhost:4100`, `ORCHESTRATOR_API_KEY=test-key-do-not-leak`, `ORCHESTRATOR_OPERATOR_PASSPHRASE=e2e-passphrase`, `SESSION_SECRET=ci-session-secret`, `NODE_ENV=production` (or `test` if production fails the cookie `secure: true` check on plain HTTP — pick `test`). Run with `&`.
7. **Boot static SPA** via `npm run lhci:serve &`.
8. `npx wait-on http://localhost:4200 http://localhost:4000/auth/me http://localhost:4100/v1/agents` to gate on readiness.
9. `npm run lhci:run` (this is the assertion step — non-zero exit fails the job).
10. `actions/upload-artifact@v4` uploading `.lighthouseci/` so failures show the report HTML.
11. Always-run cleanup step that kills the captured PIDs.

Trigger on `pull_request` and `push` to `main`. Set `permissions: contents: read` and run on `ubuntu-latest`.

### Step 5: Add the upstream-mock shim for non-Playwright contexts
**File:** `scripts/start-upstream-mock.mjs`
**Action:** Create
Tiny ESM script that imports the compiled mock from `dist/e2e/fixtures/upstream-mock.js` (or runs the TS directly with `tsx`/`ts-node` already in dev deps) and starts it on a fixed port (4100 in CI). Listens for SIGTERM/SIGINT to shut down cleanly. This keeps the workflow free of inline shell `node -e` complexity.

If the project doesn't already have a TS runtime for scripts: add `tsx` as a devDependency and invoke `tsx scripts/start-upstream-mock.ts` instead. Pick whichever is closer to existing project conventions established in T-001.

### Step 6: Seed `/runs/:id` reachability
**File:** *(no new file — verification step on `e2e/fixtures/upstream-mock.ts`)*
**Action:** Verify
Confirm that the upstream mock from T-020 always exposes `run-e2e-001` from a clean boot — i.e. the seeded paused run exists immediately on `GET /v1/runs/run-e2e-001` without any prior test interaction. If T-020's mock requires a `reset()` or a prior request to populate state, modify `upstream-mock.ts` to seed the run on construction. This is the mechanism by which `/runs/:id` is reachable in CI per the task brief.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `lighthouserc.json` | Create | Lighthouse CI config: 3 routes, accessibility ≥ 0.95, recommended preset overrides. |
| `scripts/lhci-puppeteer-login.js` | Create | Puppeteer hook that logs in via `/login` so authed routes are reachable. |
| `scripts/start-upstream-mock.mjs` | Create | Shim that boots T-020's mock on a fixed port for CI orchestration. |
| `package.json` | Modify | Add `lhci:serve`, `lhci:run`; add `@lhci/cli` and `http-server` devDeps. |
| `.github/workflows/lighthouse.yml` | Create | Build, boot mock + BFF + static server, run `lhci autorun`, upload report. |
| `e2e/fixtures/upstream-mock.ts` | Verify | Confirm `run-e2e-001` exists from clean boot for `/runs/:id` reachability. |

## Edge Cases & Risks
- **Cookies on plain HTTP in CI.** With `NODE_ENV=production`, the BFF sets `secure: true` on the session cookie (per `CLAUDE.md` BFF section), and Chromium will refuse to send it on `http://localhost`. Mitigation: run the BFF with `NODE_ENV=test` in CI, or terminate the SPA via HTTPS using `mkcert` — `test` is far simpler.
- **Lighthouse run flakiness.** `numberOfRuns: 1` is fast but can give noisy a11y scores. If flake appears, bump to 3 and rely on the median — accessibility is generally deterministic, but contrast checks can wobble on font loading. Start with 1 and reactively raise.
- **Headless Chromium fonts.** Poppins/Inter loaded from a CDN may not finish loading before the audit runs. Either preload them or self-host (per modern-minimal). Contrast ratios depend on font weights; missing fonts could push a11y score below 95 spuriously. Mitigation: ensure `<link rel="preconnect">` to the font origin and verify a single audit pass on a clean checkout before declaring the gate stable.
- **Login script runs against `/runs` audit too.** The Puppeteer hook logs in for every URL — wasteful but cheap. The `/login` skip-branch avoids logging in there (it would 404 the form after redirect).
- **Threshold drift.** If a future task introduces a regression that drops a11y to 94, the gate fails. That is the intended behavior — fix the regression, do not lower the threshold (cite `CLAUDE.md` Documentation Maintenance Discipline: a threshold change would itself be a convention change).
- **Workflow timeout.** Long boot chain (mock + BFF + static + lhci) may exceed default 6 hours, but realistically should finish in <2 minutes. Set `timeout-minutes: 10` on the job.

## Acceptance Verification
- [ ] AC "CI job runs Lighthouse against `/login` (logged-out), `/runs`, `/runs/:id` (with seeded run)" — verified by the `collect.url` array in `lighthouserc.json` (Step 1) listing all three URLs and the Puppeteer hook (Step 2) skipping login on `/login` only.
- [ ] AC "Threshold `accessibility >= 95` enforced; failures block merge" — verified by the `categories:accessibility: ['error', { minScore: 0.95 }]` assertion in `lighthouserc.json` (Step 1) — `error` severity exits non-zero — and by the workflow's `npm run lhci:run` step being a required check on the PR (configured in branch protection separately; out of repo scope).
