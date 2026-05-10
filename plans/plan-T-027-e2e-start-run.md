# Implementation Plan: T-027 — Playwright smoke for the start-run flow

## Task Reference

- **Task ID:** T-027
- **Type:** Testing
- **Workflow:** standard
- **Complexity:** S
- **Dependencies:** T-026 (submit flow working end-to-end)
- **Rationale (from task):** Covers the e2e acceptance criterion. Reuses the FEAT-001 fixture infrastructure, so the spec stays small.

## Overview

Add `e2e/start-run.spec.ts` covering: log in → click "Start a run" CTA from `/runs` → agent appears in the picker → type valid intake JSON → submit → land on `/runs/:id` → trace timeline shows ≥1 record within 2s. Add a second case asserting the malformed-JSON guard. Extend `e2e/fixtures/upstream-mock.ts` with a `POST /v1/runs` handler that returns a deterministic new run id and registers a matching trace stream.

## Implementation Steps

### Step 1: Extend the upstream mock with `POST /v1/runs`
**File:** `e2e/fixtures/upstream-mock.ts`
**Action:** Modify

- Add an in-memory record of "started runs" keyed by id. Each entry holds the `RunSummary` and a deterministic NDJSON trace string.
- New handler: `POST /v1/runs` reads the request body (`{ agentRef, intake, budget? }`), generates a new id (e.g., `run-e2e-start-${counter++}`), constructs a `RunSummary` (status `running`, `startedAt: new Date().toISOString()`, etc.), persists it alongside a small canned trace (one `executor_call` record so the detail page renders something within 2s), responds `202` with `{ data: <RunSummary>, meta: null }`.
- The existing `GET /v1/runs/:id`, `GET /v1/runs/:id/trace`, and `GET /v1/runs` handlers must read from this same store so the post-submit detail page renders the new run. If the current mock keeps `runs` as a top-level constant, route the new handler to mutate it; if it's per-route static fixture data, refactor to a single shared `Map`.
- Idempotency: do not reset the store between requests; the `/__test/reset` endpoint already exists for between-test cleanup — confirm it clears the new state too.

### Step 2: Add `data-testid` parity check
**File:** `src/app/features/run-start/run-start.component.html`
**Action:** Verify only

- Confirm T-024/T-025/T-026 added the testids the spec needs: `run-start`, `agent-picker`, `intake-editor`, `submit-button`, `cancel-button`, `intake-error`, `intake-server-error`, `agent-error`, `start-run-cta-header`, `start-run-cta-empty`, `format-button`, `refresh-agents`, `max-steps`.
- If any are missing, add them now in this PR's prep step. Do not redesign the markup.

### Step 3: Write the happy-path spec
**File:** `e2e/start-run.spec.ts`
**Action:** Create

```ts
import { test, expect } from '@playwright/test';

test.describe('start a run', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('http://127.0.0.1:4100/__test/reset');
  });

  test('operator starts a run and lands on detail with trace streaming', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.getByTestId('passphrase-input').fill('e2e-passphrase');
    await page.getByTestId('login-submit').click();
    await page.waitForURL('**/runs');

    // Click the header CTA
    await page.getByTestId('start-run-cta-header').click();
    await page.waitForURL('**/runs/new');

    // Pick an agent (first one from the seeded mock list)
    const agentPicker = page.getByTestId('agent-picker');
    await agentPicker.selectOption({ index: 1 }); // index 0 is the disabled placeholder

    // Type valid intake JSON
    await page.getByTestId('intake-editor').fill('{ "featureBriefPath": "docs/work-items/FEAT-002.md" }');

    // Submit
    await page.getByTestId('submit-button').click();

    // Detail page reached and trace renders
    await page.waitForURL(/\/runs\/run-e2e-start-/);
    await expect(page.getByTestId('trace-timeline')).toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId('trace-timeline').locator('[data-testid="trace-step"]')).not.toHaveCount(0);
  });

  test('malformed JSON keeps submit disabled and surfaces an inline error', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('passphrase-input').fill('e2e-passphrase');
    await page.getByTestId('login-submit').click();
    await page.waitForURL('**/runs');

    await page.goto('/runs/new');
    await page.getByTestId('agent-picker').selectOption({ index: 1 });
    await page.getByTestId('intake-editor').fill('{not json');

    // Wait past the 200ms parse debounce
    await page.waitForTimeout(300);

    await expect(page.getByTestId('intake-error')).toBeVisible();
    await expect(page.getByTestId('submit-button')).toBeDisabled();
  });
});
```

- Use the existing `playwright.config.ts` `webServer` array — no config changes needed; the BFF, SPA, and upstream mock are all booted by the existing setup.
- Do not assert specific Tailwind classes; rely on `data-testid` and Playwright's accessibility-aware queries.
- The `.toHaveCount(0)` negation is robust to NDJSON timing: any record landing within the 2s window passes.

### Step 4: Sanity-check the existing e2e fixtures
**File:** `e2e/fixtures/upstream-mock.ts`
**Action:** Verify

- `POST /v1/runs` must return the camelCase wire shape: `data: { id, agentRef, status, intake, startedAt, lastStepNumber: null, ... }`. No snake↔camel translation — see `CLAUDE.md` "Wire shapes are camelCase end-to-end".
- The trace seeded for the new run id must include enough records that the detail page's existing `trace-timeline` selector resolves. One `executor_call` record is sufficient.
- Confirm the existing `GET /v1/runs` (the list endpoint used by `/runs`) does not need to know about the new run before it's started — the test never returns to `/runs` after submit, so list-side changes are out of scope.

### Step 5: Run locally three times
**Action:** Verify

- `npm run e2e -- start-run.spec.ts` three times back-to-back.
- The AC requires "no flakiness across 3 consecutive local runs". If any flake surfaces, debug before the PR — do not raise the timeout above 2s without justification (operator-perceived "instant" is the spec's intent).

## Files Affected

| File | Action | Summary |
|------|--------|---------|
| `e2e/start-run.spec.ts` | Create | Two specs: happy path + malformed-JSON guard. |
| `e2e/fixtures/upstream-mock.ts` | Modify | Add `POST /v1/runs` handler; ensure `__test/reset` clears the new store. |
| `src/app/features/run-start/run-start.component.html` | Verify | Confirm all required `data-testid` attributes are present (add any missing ones). |

## Edge Cases & Risks

- **Existing tests in `e2e/critical-path.spec.ts` and `e2e/cancel-run.spec.ts` share the upstream mock.** When we move from static data to mutable runs, make sure neither pre-existing test depends on a fixed `GET /v1/runs` snapshot that the new POST would mutate. The `__test/reset` between tests should isolate them.
- **NDJSON timing flake:** the 2s `toBeVisible` is generous on local CI; if it flakes, the issue is upstream-mock streaming, not test-side timing. Inspect the mock's chunked-response logic before raising the timeout.
- **Selector drift:** if T-024/T-025 evolved the testids, sync the spec accordingly. Do not introduce CSS-class selectors as a fallback.
- **Workers=1 stays in place:** the existing `playwright.config.ts` runs serially because the upstream mock is in-process and stateful. Keep workers=1; do not parallelize.

## Acceptance Verification

- [ ] **AC: spec passes locally and in CI** — Local 3-run pass; CI green on PR.
- [ ] **AC: open form via CTA → submit → land on `/runs/:id` → trace shows ≥1 record within 2s** — Happy-path spec.
- [ ] **AC: malformed JSON disables submit and shows inline error** — Second spec case.
- [ ] **AC: upstream mock `POST /v1/runs` returns 202 with new `RunSummary` and registers trace** — Verified by happy-path landing on detail with rendered trace.
- [ ] **AC: no flakiness across 3 consecutive local runs** — Manual verification before opening the PR.
