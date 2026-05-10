# Implementation Plan: T-026 — `RunsService.startRun` + submit flow + ProblemDetails error mapping

## Task Reference

- **Task ID:** T-026
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** M
- **Dependencies:** T-025 (form fields and validator wired)
- **Rationale (from task):** Covers the AC: submit calls `POST /api/v1/runs` exactly once; success redirects; `400 invalid-intake` shows on the intake field; `404 agent-not-found` shows on the picker; network/`502` shows the global `app-error-state` with retry.

## Overview

Extend `RunsService` with `startRun(req: StartRunRequest): Observable<RunSummary>` and wire `RunStartComponent.onSubmit` to call it. On `202`, navigate to `/runs/:id`. On `ProblemDetailsError`, branch by `code`: `invalid-intake` → field-level error on the intake editor; `agent-not-found` → field-level error on the agent picker (with refresh affordance); `upstream-unavailable` or status `0` (network) → render the full-page error state with a retry that re-submits the unchanged form. Submit is disabled while in-flight; re-enabled on error.

## Implementation Steps

### Step 1: Add `startRun` to `RunsService`
**File:** `src/app/core/runs.service.ts`
**Action:** Modify

```ts
import type { StartRunRequest } from '../models';
// ...
startRun(req: StartRunRequest): Observable<RunSummary> {
  return this.api.post<RunSummary>('/api/v1/runs', req).pipe(map(({ data }) => data));
}
```

- Place after `cancel()`. Request body is the typed `StartRunRequest` from T-024; response is unwrapped to `RunSummary` from the envelope, mirroring `cancel()`.
- Errors flow through `ApiClient`'s `catchError` and arrive as `ProblemDetailsError` instances (existing pattern from FEAT-001) — no new error types here.

### Step 2: Add `startRun` unit tests
**File:** `src/app/core/runs.service.spec.ts`
**Action:** Modify

Add a `describe('startRun')` covering:
- Posts to `/api/v1/runs` with the supplied body and unwraps `data` to `RunSummary`.
- Propagates a `ProblemDetailsError` (status 400, `code: 'invalid-intake'`).
- Propagates a `ProblemDetailsError` (status 404, `code: 'agent-not-found'`).
- Propagates a `ProblemDetailsError` (status 502, `code: 'upstream-unavailable'`).

Mock `ApiClient.post` via `provideHttpClientTesting()` + `HttpTestingController` consistent with the existing `runs.service.spec.ts` pattern.

### Step 3: Component — submit handler
**File:** `src/app/features/run-start/run-start.component.ts`
**Action:** Modify

- Inject `RunsService` and `Router`. Add new state:
  - `readonly submitError = signal<{ scope: 'intake' | 'agent' | 'page'; title: string; detail?: string; code?: string } | null>(null);`
  - Reuse `submitting` from T-024.
- Replace the stub `onSubmit`:

```ts
onSubmit(event: Event): void {
  event.preventDefault();
  if (this.submitDisabled()) return;

  const intakeRaw = this.form.controls.intake.value;
  const parsed = parseIntake(intakeRaw);
  if (!parsed.valid) return; // belt-and-suspenders; submitDisabled should already block this
  const maxSteps = this.form.controls.maxSteps.value;

  const req: StartRunRequest = {
    agentRef: this.form.controls.agentRef.value,
    intake: parsed.parsed!,
    ...(maxSteps != null ? { budget: { maxSteps } } : {}),
  };

  this.submitting.set(true);
  this.submitError.set(null);
  this.runsService.startRun(req).subscribe({
    next: (run) => {
      // Don't clear submitting before navigating — leaves the button disabled
      // through teardown so a stray click can't double-submit during the route
      // change. Component will be destroyed by the navigation.
      void this.router.navigate(['/runs', run.id]);
    },
    error: (err: unknown) => {
      this.submitting.set(false);
      this.submitError.set(this.mapError(err));
    },
  });
}

private mapError(err: unknown): { scope: 'intake' | 'agent' | 'page'; title: string; detail?: string; code?: string } {
  if (err instanceof ProblemDetailsError) {
    if (err.code === 'invalid-intake') {
      return { scope: 'intake', title: err.title, detail: err.detail, code: err.code };
    }
    if (err.code === 'agent-not-found') {
      return { scope: 'agent', title: err.title, detail: err.detail, code: err.code };
    }
    // upstream-unavailable, upstream-error, status 0 (network), unknown — full-page.
    return { scope: 'page', title: err.title, detail: err.detail, code: err.code };
  }
  return { scope: 'page', title: 'Unexpected error' };
}

retrySubmit(): void {
  // The form is unchanged because we never cleared it on error; re-fire submit.
  this.onSubmit(new Event('submit'));
}
```

- Import `ProblemDetailsError` from `../../core/problem-details.error`.
- The `submitDisabled()` computed from T-025 already accounts for `submitting()`.

### Step 4: Component template — surface scoped errors
**File:** `src/app/features/run-start/run-start.component.html`
**Action:** Modify

- **Page-level error branch** (top of the card, before the form): when `submitError()?.scope === 'page'`, render the existing shared `app-full-page-error` component with `title`, `detail`, `code`, and `retry={ retrySubmit.bind(this) }`. Hide the form in this branch — operator must dismiss/retry first. (Mirrors the runs-list pattern.)
  - Import `FullPageErrorComponent` in the component's `imports` array.
- **Agent-scoped error**: under the agent picker, when `submitError()?.scope === 'agent'`: `<p data-testid="agent-error" class="text-red-500 text-sm mt-1">{{ submitError()!.title }}</p>` plus a "Refresh agents" button that calls `loadAgents()` and clears `submitError`.
- **Intake-scoped error**: under the intake editor (alongside the existing client-side parse error), when `submitError()?.scope === 'intake'`: `<p data-testid="intake-server-error" class="text-red-500 text-sm">{{ submitError()!.title }}</p>`. Distinct `data-testid` from the client-side `intake-error` so e2e can disambiguate.
- **Submit button disabled binding** — already wired to `submitDisabled()` from T-025; no change.

### Step 5: Spec — submit flow tests
**File:** `src/app/features/run-start/run-start.component.spec.ts`
**Action:** Modify

Add the following cases (all using a stubbed `RunsService` whose `startRun` returns a controlled `Subject` so we can assert in-flight state):

1. **Success path:** form filled; click submit; `Subject` emits a `RunSummary`; assert `Router.navigate(['/runs', 'run-123'])` was called once; assert submit was disabled during the in-flight period.
2. **Single-call guard:** click submit twice in quick succession (before `Subject` resolves); assert `RunsService.startRun` was called exactly once.
3. **400 mapping:** `Subject.error(new ProblemDetailsError({ status: 400, code: 'invalid-intake', title: 'Intake JSON failed validation' }))`; assert `data-testid="intake-server-error"` is present with the title; form values preserved (intake textarea still contains typed JSON); submit re-enabled.
4. **404 mapping:** `code: 'agent-not-found'`; assert `data-testid="agent-error"`; "Refresh agents" button visible; clicking it re-fetches agents and clears `submitError`.
5. **502 mapping:** `code: 'upstream-unavailable'`; assert `app-full-page-error` rendered, form hidden; clicking retry re-submits the unchanged payload.
6. **Network error (status 0):** `Subject.error(new ProblemDetailsError({ ..., status: 0, code: 'unknown', title: 'Unexpected error' }))`; assert page-level error path.
7. **Form values preserved on every error path** — the intake textarea must still have the operator's typed JSON.

### Step 6: Confirm `submitDisabled` includes `submitting`
**File:** `src/app/features/run-start/run-start.component.ts`
**Action:** Modify (verify only)

- The `submitDisabled` computed from T-025 already reads `submitting()`. Re-check no regressions in this PR. If `submitting` was missed there, add it now.

## Files Affected

| File | Action | Summary |
|------|--------|---------|
| `src/app/core/runs.service.ts` | Modify | Add `startRun(req): Observable<RunSummary>`. |
| `src/app/core/runs.service.spec.ts` | Modify | Cover success + 400/404/502 propagation. |
| `src/app/features/run-start/run-start.component.ts` | Modify | Real `onSubmit`, `submitError` signal, `mapError`, `retrySubmit`. |
| `src/app/features/run-start/run-start.component.html` | Modify | Page-level error branch + scoped errors under agent / intake. |
| `src/app/features/run-start/run-start.component.spec.ts` | Modify | Cover success, single-call guard, 400/404/502, network, form preservation. |

## Edge Cases & Risks

- **`maxSteps` serialization** — when blank, omit the `budget` key entirely (do not send `budget: { maxSteps: null }`). The spread `...(maxSteps != null ? { budget: { maxSteps } } : {})` enforces this. **Open question from the work item:** verify against a real orchestrator response during implementation; if the orchestrator rejects `budget` omission, switch to a default value (likely a server-side default exists per `docs/api-spec.md`).
- **Double-submit:** disabled-while-in-flight is the guard. Per `CLAUDE.md`, write endpoints are idempotent so even a leak wouldn't corrupt state — the disable is for UX, not correctness.
- **Navigation race:** we deliberately leave `submitting=true` through `Router.navigate` so the button stays disabled until destruction. If `Router.navigate` rejects (rare; only on guard mismatch), the user is left on the page with submit disabled and no error — add a `.then((ok) => { if (!ok) this.submitting.set(false); })` to be safe.
- **`agent-not-found` after a stale agent picker:** if the orchestrator deregistered the agent between page load and submit, the operator sees the inline error and can refresh. Do not auto-clear the form's `agentRef` — let them reselect.
- **`invalid-intake` payload preservation:** never reset `form.controls.intake` on error — operators must be able to fix and resubmit. Tested in spec.
- **Toast-vs-inline policy:** no success toast (navigation is feedback). For errors, follow FEAT-001's convention: validation/structural errors are inline; transport errors are page-level. Do not add new toast surfaces here.

## Acceptance Verification

- [ ] **AC: posts to `/api/v1/runs` once and returns typed `RunSummary`** — `runs.service.spec.ts` test.
- [ ] **AC: 202 navigates to `/runs/:id`** — Component spec success-path test.
- [ ] **AC: 400 inline on intake without losing payload** — Component spec 400 test.
- [ ] **AC: 404 on agent picker with refresh affordance** — Component spec 404 test.
- [ ] **AC: 502 / network → full-page error with working retry** — Component spec 502 + network tests.
- [ ] **AC: submit disabled while in-flight, re-enabled on error** — Component spec single-call-guard + each error test.
- [ ] **AC: unit tests cover success, 400, 404, 502, double-submit guard** — All present per Step 5.
