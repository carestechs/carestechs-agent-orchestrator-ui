# Implementation Plan: T-020 — E2E smoke flow — login → list → detail → signal

## Task Reference
- **Task ID:** T-020
- **Type:** Testing
- **Workflow:** standard
- **Complexity:** M
- **Rationale:** Locks the success criterion "operator submits signal in under 30 seconds" and protects the v1 critical path against regressions. Also serves as the carrier for the browser-side `Authorization`-header assertion required by T-022.

## Overview
Build a Playwright smoke suite that runs the full operator loop end-to-end against a deterministic in-process upstream mock — login, see paused runs, open a run, observe NDJSON trace records arrive, submit a signal, observe the success toast, resubmit and observe the `meta.alreadyReceived` notice — plus a second spec that exercises the cancel flow. The mock upstream is a tiny Node HTTP server that the BFF talks to via the `ORCHESTRATOR_BASE_URL` env override; no real orchestrator is contacted in CI. The same suite captures every browser request and asserts none of them carry an `Authorization` header (per `CLAUDE.md` Anti-Patterns "Don't ship the API key to the browser" and feeding T-022).

## Implementation Steps

### Step 1: Scaffold the upstream mock
**File:** `e2e/fixtures/upstream-mock.ts`
**Action:** Create
Create a small Node HTTP server (`http.createServer`) exposing the orchestrator surface the BFF forwards under `/api/v1/*`. It listens on a port chosen at runtime (port 0, then read `address().port`) and exposes a `start()`/`stop()` API plus a `baseUrl` getter so `playwright.config.ts` can pass the URL to the BFF as `ORCHESTRATOR_BASE_URL`.

Endpoints to implement (camelCase wire shapes per `CLAUDE.md` Patterns "Wire shapes are camelCase end-to-end" and `docs/data-model.md`):
- `GET /v1/runs?status=paused&page=1&pageSize=20` → `{ data: [<one paused RunSummary>], meta: { page: 1, pageSize: 20, total: 1 } }` with the seeded `runId` from the test (e.g. `run-e2e-001`).
- `GET /v1/runs/:id` → `RunDetail` with `status: 'paused'`, `agentRef: 'demo-agent@1.0.0'`, `intake: { ... }`, `currentNode: 'await-human'`.
- `GET /v1/runs/:id/trace?follow=true` → respond with `Content-Type: application/x-ndjson`, `Transfer-Encoding: chunked`, then write a scripted sequence of NDJSON lines with small delays so the SPA observes incremental arrival:
  1. `{ kind: 'step', state: 'started', stepNumber: 1, ts: '...' }`
  2. `{ kind: 'policy_call', ts: '...' }`
  3. `{ kind: 'executor_call', state: 'dispatched', mode: 'human', taskId: 'task-001', intake: {...}, ts: '...' }`
  Then keep the response open (do NOT end the stream) until either the test signals "advance" (via a hidden control endpoint, see below) or the client aborts. This matches the `follow=true` semantics from `docs/api-spec.md`.
- `POST /v1/runs/:id/signals/dispatch` — first call returns `202 { data: { receiptId: 'r-001' }, meta: { alreadyReceived: false } }` and pushes a follow-up `executor_call` with `state: 'completed'` plus a `step` `state: 'completed'` onto the open trace stream. Subsequent calls with the same `(runId, name, taskId)` return `202` with `meta: { alreadyReceived: true }` per `docs/api-spec.md` § signals replay rule.
- `POST /v1/runs/:id/cancel` — returns `202 { data: { ... }, meta: null }` and pushes a terminal `step` with `state: 'completed'` and flips the in-memory run status to `cancelled`. A second cancel returns `409 application/problem+json { code: 'run-already-terminal', title: 'Run already terminal', status: 409, type: 'about:blank' }`.
- `GET /v1/agents` → `{ data: [{ ref: 'demo-agent@1.0.0', ... }], meta: null }`.

Implementation notes:
- Use `res.flushHeaders()` and `res.write(line + '\n')` per record; `setTimeout(..., 100)` between lines so the SPA's `TraceStreamService` (T-010) renders incrementally and the AC "first record paints within 1s" is exercised.
- Disable any compression (`Content-Encoding` must NOT be set) per the constraint in T-006.
- Honour `AbortController` aborts: on `req.on('close', ...)` clean up the scheduled timers so the mock doesn't leak between tests.
- Expose a `reset()` method that wipes in-memory state between specs so tests are isolated.
- Use only Node built-ins — no Express/Fastify dependency for the mock; this keeps the fixture lightweight and avoids accidental compatibility coupling with the real BFF stack.
- Named export only per `CLAUDE.md` Naming Conventions.

### Step 2: Configure Playwright `webServer` to boot SPA + BFF + mock together
**File:** `playwright.config.ts`
**Action:** Modify
Update the existing config (created in T-001) to launch three processes via `webServer` (Playwright supports an array). Order matters because the BFF needs `ORCHESTRATOR_BASE_URL` known before it boots:

1. Run a small Node script that boots `upstream-mock.ts` on a fixed test port (e.g. 4100) and writes a readiness file. Easier alternative: skip the mock as a `webServer` entry and instead start it from a Playwright **global setup** (Step 3).
2. BFF: `npm run bff:dev` with env `ORCHESTRATOR_BASE_URL=http://localhost:4100`, `ORCHESTRATOR_API_KEY=test-key-do-not-leak`, `ORCHESTRATOR_OPERATOR_PASSPHRASE=e2e-passphrase`, `SESSION_SECRET=e2e-session-secret`, `NODE_ENV=test`. Port 4000.
3. SPA: `npm run start` on port 4200 (proxy.conf.json forwards `/api` and `/auth` to the BFF).

Set `webServer.reuseExistingServer: !process.env.CI` and `timeout: 60_000` on each entry. Set `use.baseURL: 'http://localhost:4200'` and `use.trace: 'on-first-retry'`.

Cite: `CLAUDE.md` Quick Reference for the script names; do not invent new ones.

### Step 3: Add Playwright global setup that starts the mock
**File:** `e2e/global-setup.ts`
**Action:** Create
Boot the `upstream-mock` server, store its port via `process.env.E2E_UPSTREAM_PORT` (or to a temp file) and return a teardown that stops it. Reference it from `playwright.config.ts` via `globalSetup: './e2e/global-setup.ts'` and `globalTeardown: './e2e/global-teardown.ts'`.

This avoids the chicken-and-egg of needing the mock's port available to the BFF `webServer` env before either has started — the global setup runs first, picks the port, then the `webServer` entries inherit the env.

### Step 4: Add Playwright global teardown
**File:** `e2e/global-teardown.ts`
**Action:** Create
Stop the upstream mock cleanly. Idempotent — safe if called twice.

### Step 5: Author the critical-path spec
**File:** `e2e/critical-path.spec.ts`
**Action:** Create
Single Playwright `test.describe('critical path', ...)` block. Steps:

1. **Setup request capture (also covers T-022 browser-side AC).** Inside the test, before `page.goto`, attach a listener:
   ```ts
   const seenAuthHeaders: string[] = [];
   page.on('request', (req) => {
     const auth = req.headers()['authorization'];
     if (auth) seenAuthHeaders.push(`${req.method()} ${req.url()}`);
   });
   ```
   At the end of the test (and also at every `await expect(...).toBeVisible()` checkpoint, optionally), assert `expect(seenAuthHeaders).toEqual([])`. This realizes the AC "no `Authorization` header on any browser-initiated request" and the T-022 browser-side assertion. The mocked passphrase value `e2e-passphrase` and the seed key `test-key-do-not-leak` are also asserted to NOT appear in any captured request body or response.
2. **Login.** `page.goto('/login')`, fill the passphrase field with `e2e-passphrase`, click submit. Expect URL to become `/runs`.
3. **Runs list — paused.** Expect the table to render exactly one row for `run-e2e-001` with status badge `Paused` (per the modern-minimal palette and `docs/ui-specification.md` § Status Badge Mapping). Click the row.
4. **Run detail — trace streaming.** Expect URL `/runs/run-e2e-001`. Within 1500ms (generous bound for CI), expect at least the first three trace records to render in the timeline (assert by visible text or `data-testid` on the timeline list items). This locks the AC "trace begins streaming within 1s" via the mock's scripted delays.
5. **Submit signal.** Expect the awaiting-signal panel to be visible with `taskId` pre-filled to `task-001` (per T-019). Fill `commitSha=abc1234`, `prUrl=https://example.test/pr/1`, `implementationNotes=ok`. Click "Submit signal".
6. **Success toast.** Expect a toast with text matching `/signal received/i` (not `already`). Per T-019 AC.
7. **Resubmit shows alreadyReceived notice.** Click submit again with the same payload. Expect a toast matching `/already received/i`. Per `docs/api-spec.md` § signals replay rule and T-019 AC.
8. **No Authorization header on browser side.** Final `expect(seenAuthHeaders).toEqual([])`.

Use `data-testid` selectors where text would be brittle. Add the testids to component templates only as a follow-up if missing (note in Edge Cases).

### Step 6: Author the cancel-flow spec
**File:** `e2e/cancel-run.spec.ts`
**Action:** Create
Separate spec covering the cancel branch:
1. Login (factor into a fixture later if duplication grows).
2. Open the same `run-e2e-001`.
3. Click Cancel; the confirmation modal opens (per T-012). Click "Confirm".
4. Expect run header status badge to flip to `Cancelled` after the mock pushes the terminal step.
5. Cancel button should now be hidden (per T-018 AC "Cancel button is hidden when run is terminal").
6. Reload the run, attempt cancel programmatically by hitting the API via `request.fetch` (through the SPA-origin proxy, so it goes via the BFF) — expect a 409 problem+json with `code: 'run-already-terminal'`. (Alternative: drive through UI by pre-cancelling via API and then loading the page; pick whichever is more deterministic.)

### Step 7: Wire `npm run e2e` and CI
**File:** `package.json`
**Action:** Modify
Confirm `"e2e": "playwright test"` exists from T-001. Add a Playwright cache install instruction in the project README **only if** the user later requests it — do not write README changes proactively (per the global rule "NEVER proactively create documentation files").

Also confirm CI runs `npx playwright install --with-deps chromium` before `npm run e2e`. If a CI workflow file already exists from T-001 and lacks this, modify it; otherwise leave for T-021's workflow to install browsers.

### Step 8: Add a `data-testid` audit pass
**Files:**
- `src/app/features/runs-list/runs-list.component.html` — Modify
- `src/app/features/run-detail/run-detail.component.html` — Modify
- `src/app/features/run-detail/awaiting-signal-panel.component.html` — Modify
- `src/app/features/login/login.component.html` — Modify
- `src/app/shared/toast-host.component.html` — Modify
- `src/app/shared/confirm-modal.component.html` — Modify
**Action:** Modify
Add `data-testid` attributes for the selectors the specs use: `login-passphrase`, `login-submit`, `runs-table`, `run-row-<id>` (or row by `data-testid="run-row"` plus an inner `data-run-id`), `run-status-badge`, `trace-record`, `signal-form`, `signal-task-id`, `signal-submit`, `cancel-button`, `confirm-modal-confirm`, `toast`. These do not affect rendering, do not violate Tailwind-only styling (`CLAUDE.md` Patterns), and do not require component CSS.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `e2e/fixtures/upstream-mock.ts` | Create | Deterministic in-process mock orchestrator (NDJSON trace, signal endpoint, cancel). |
| `e2e/global-setup.ts` | Create | Boots the upstream mock; stores port for BFF env. |
| `e2e/global-teardown.ts` | Create | Stops the upstream mock cleanly. |
| `e2e/critical-path.spec.ts` | Create | Login → list → detail → trace → signal → resubmit; asserts no `Authorization` in browser. |
| `e2e/cancel-run.spec.ts` | Create | Cancel flow including the 409 terminal-cancel path. |
| `playwright.config.ts` | Modify | Add `webServer` array (BFF + SPA), `globalSetup`/`globalTeardown`, `baseURL`. |
| `package.json` | Modify (verify) | Confirm `"e2e": "playwright test"` exists from T-001. |
| `src/app/features/login/login.component.html` | Modify | Add `data-testid` hooks. |
| `src/app/features/runs-list/runs-list.component.html` | Modify | Add `data-testid` hooks. |
| `src/app/features/run-detail/run-detail.component.html` | Modify | Add `data-testid` hooks for trace records, status badge, cancel. |
| `src/app/features/run-detail/awaiting-signal-panel.component.html` | Modify | Add `data-testid` hooks for signal form fields and submit. |
| `src/app/shared/toast-host.component.html` | Modify | Add `data-testid="toast"` on the rendered toast root. |
| `src/app/shared/confirm-modal.component.html` | Modify | Add `data-testid="confirm-modal-confirm"` on the confirm button. |

## Edge Cases & Risks
- **Port collisions in CI.** Resolved by binding the mock to port 0 and discovering the port at runtime; the BFF receives the port via `ORCHESTRATOR_BASE_URL` from env set in `global-setup`.
- **Stream cleanup.** If the SPA navigates away mid-stream, the mock must release timers on `req.on('close')` — otherwise tests leak handles and Playwright's `webServer` won't shut down. Handled in Step 1.
- **Race on first trace record.** Asserting "first record within 1s" is flaky on cold CI; use a 1500ms bound and prefer waiting for a `data-testid="trace-record"` to appear rather than a fixed sleep.
- **Toast text drift.** `meta.alreadyReceived` toast wording is owned by T-019; align the regex `/already received/i` with whatever T-019 ships and update both together if it changes.
- **Auth header capture is incomplete on subresources.** `page.on('request')` covers all browser-initiated requests including XHR/fetch and static asset fetches; this is the right hook. Subresources from third-party origins (none expected) would also be caught. Static asset fetches from the dev server obviously have no `Authorization` header — assertion remains valid.
- **The mock returns problem+json with `Content-Type: application/problem+json`** — must include the `application/problem+json` media type exactly so the BFF pass-through (T-005) and `ApiClient` (T-007) recognize it.
- **Cookies in Playwright.** Default Playwright context isolates cookies per test; login must run inside each `test()` or be promoted to a Playwright `storageState` fixture later if tests grow.

## Acceptance Verification
- [ ] AC "`npm run e2e` passes locally and in CI" — verified by running the command locally and by the CI workflow added in T-021 (or this task's CI step) executing both specs green.
- [ ] AC "BFF is run with a fixture upstream that emits a deterministic trace and accepts signals" — verified by `e2e/fixtures/upstream-mock.ts` (Step 1) being the only upstream the BFF talks to during E2E (BFF env `ORCHESTRATOR_BASE_URL` points at it via global setup, Step 3).
- [ ] AC "Test asserts no `Authorization` header in any browser-initiated request" — verified by the `seenAuthHeaders` assertion in `critical-path.spec.ts` (Step 5, item 8); also satisfies T-022's browser-side AC.
