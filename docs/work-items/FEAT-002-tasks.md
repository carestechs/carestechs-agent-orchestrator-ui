# FEAT-002 — Implementation Tasks

**Feature:** [FEAT-002 — Start a run](./FEAT-002-start-a-run.md)
**Workflow:** mockup-first (inherited; per-task overridden where appropriate)
**Generated:** 2026-05-10

---

## Foundation

### T-024: Scaffold `RunStartComponent` route, model, and re-enable "Start a run" CTAs

**Type:** Frontend
**Workflow:** mockup-first
**Complexity:** S
**Dependencies:** None (FEAT-001 merged)

**Description:**
Add the `/runs/new` lazy route loading a new standalone `RunStartComponent` (with separate `templateUrl`, `styles: []`, signals). Stub the screen with a card-shaped layout placeholder so navigation works end-to-end. Wire the existing dead "Start a run" CTAs on `/runs` (header link and empty-state CTA) to `routerLink="/runs/new"`. Define a `StartRunRequest` interface in `src/app/models/`.

**Rationale:**
Closes the dead-end CTAs from FEAT-001 and gives downstream tasks a real component to work in. Splitting scaffold from the form fields keeps PR diffs reviewable. Mockup-first because this is a new user-facing screen — generate an HTML mockup via `.ai-framework/prompts/mockup-generation.md` against `docs/ui-specification.md` § "Screen: Run Start" before implementing the template.

**Acceptance Criteria:**
- [ ] Navigating to `/runs/new` (authenticated) renders `RunStartComponent`; unauthenticated navigation hits the existing `authGuard` and redirects to `/login`.
- [ ] The `/runs` header CTA and empty-state CTA both navigate to `/runs/new` via `routerLink`.
- [ ] `RunStartComponent` is `standalone: true`, uses `templateUrl`, sets `styles: []`, declares signals for `submitting` and `error`.
- [ ] `src/app/models/start-run-request.ts` exports a `StartRunRequest` interface matching the `POST /api/v1/runs` request body in `docs/api-spec.md`.
- [ ] An approved mockup exists at `mockups/run-start.html` before the template is fleshed out.

**Files to Modify/Create:**
- `src/app/features/run-start/run-start.component.ts` / `.html` / `.spec.ts` — new.
- `src/app/app.routes.ts` — add `{ path: 'runs/new', loadComponent: ..., canMatch: [authGuard] }` ordered before the `:id` route.
- `src/app/features/runs-list/runs-list.component.html` — wire CTAs.
- `src/app/models/start-run-request.ts` — new.
- `mockups/run-start.html` — new (per mockup-first workflow).

**Technical Notes:**
- Route order matters: `/runs/new` must be declared before `/runs/:id` to avoid `id="new"` matching the detail route.
- Default-export wrapper required by `loadComponent`.
- No new BFF route, no new wire types beyond `StartRunRequest`.

---

## Frontend

### T-025: Agent picker + intake JSON editor with client-side validation

**Type:** Frontend
**Workflow:** standard
**Complexity:** M
**Dependencies:** T-024

**Description:**
Implement the form body of `RunStartComponent`: an agent dropdown populated via `AgentsService` (reuse the existing service from FEAT-001), a monospace `<textarea>` for intake JSON with live `JSON.parse` validation and inline parse-error message, an optional `maxSteps` numeric input (positive integer, blank = omit), and a "Format" button that pretty-prints the textarea contents on demand. Use `ReactiveFormsModule`.

**Rationale:**
Covers AC: agent picker loads agents; malformed JSON is caught before submit; submit is gated on client validity. Pure form work, no network beyond the existing `AgentsService.list()` — hence `standard` workflow against the approved mockup from T-024.

**Acceptance Criteria:**
- [ ] The agent picker lists agents returned by `AgentsService` and shows a friendly empty state ("No agents registered — register one in the orchestrator and refresh") with a refresh button when the list is empty.
- [ ] Typing malformed JSON in the intake field surfaces an inline parse error within ~200ms (debounced) and disables the submit button.
- [ ] Blank `maxSteps` is treated as "omit from payload"; non-positive integers fail client validation with an inline message.
- [ ] The Format button parses the current intake and rewrites it as `JSON.stringify(value, null, 2)`; if parse fails, it does nothing and surfaces the parse error.
- [ ] Unit tests cover the JSON validator, the maxSteps validator, and the empty-agents state.
- [ ] Cancel button navigates back to `/runs` via `Location.back()` (or `/runs` fallback when there is no history entry).

**Files to Modify/Create:**
- `src/app/features/run-start/run-start.component.ts` / `.html` / `.spec.ts` — flesh out form.
- `src/app/features/run-start/intake-json.validator.ts` / `.spec.ts` — pure validator.
- (No `AgentsService` changes expected; if a `refresh()` method does not yet exist, add one alongside.)

**Technical Notes:**
- Keep the textarea controlled by `FormControl<string>`; do not bind it to a parsed object — the operator's typing must not be re-stringified mid-edit.
- Debounce the parse via `toSignal(form.valueChanges.pipe(debounceTime(200)))` or a small custom helper; do not reach for a full RxJS pipeline if not needed.
- Tailwind only — no component CSS file.

---

### T-026: `RunsService.startRun` + submit flow + ProblemDetails error mapping

**Type:** Frontend
**Workflow:** standard
**Complexity:** M
**Dependencies:** T-025

**Description:**
Add `startRun(req: StartRunRequest): Observable<RunSummary>` to `RunsService`, wire submit in `RunStartComponent`, and map errors per the matrix below. On `202`, navigate to `/runs/:id` for the returned run. Disable the submit button while in-flight; re-enable on error.

**Rationale:**
Covers AC: submit calls `POST /api/v1/runs` exactly once; success redirects; `400 invalid-intake` shows on the intake field; `404 agent-not-found` shows on the picker; network/`502` shows the global `app-error-state` with retry.

**Acceptance Criteria:**
- [ ] `RunsService.startRun` posts to `/api/v1/runs` and returns the typed `RunSummary` from the `data` envelope.
- [ ] On `202` the component navigates to `/runs/:id` for the returned id.
- [ ] `400` with `code: invalid-intake` displays the problem `title` as a field-level error on the intake editor without losing the typed payload.
- [ ] `404` with `code: agent-not-found` displays the problem `title` on the agent picker with a "refresh agents" affordance.
- [ ] Network errors and `502 upstream-unavailable` render the existing `app-error-state` with a retry that re-submits the unchanged form.
- [ ] Submit is disabled while in-flight; re-enabled on error so the operator can retry without page reload.
- [ ] Unit tests cover: success path, 400 mapping, 404 mapping, 502 mapping, double-submit guard.

**Files to Modify/Create:**
- `src/app/core/runs.service.ts` / `.spec.ts` — add `startRun`.
- `src/app/features/run-start/run-start.component.ts` / `.html` / `.spec.ts` — submit handler + error binding.

**Technical Notes:**
- Reuse the existing problem-details parsing helper from FEAT-001; do not introduce a parallel one.
- Do **not** dedupe client-side — write endpoints are idempotent (per `CLAUDE.md`); the disabled-while-in-flight guard is enough.
- No toast on success — the navigation itself is feedback. Mirror the FEAT-001 detail-page convention.

---

## Testing

### T-027: Playwright smoke for the start-run flow

**Type:** Testing
**Workflow:** standard
**Complexity:** S
**Dependencies:** T-026

**Description:**
Add a Playwright spec that logs in, navigates to `/runs/new` via the header CTA, selects an agent, types valid intake JSON, submits, and asserts navigation to `/runs/:id` with a streaming trace. Use the existing in-process upstream mock (`e2e/fixtures/upstream-mock.ts`) — extend it with `POST /v1/runs` returning a deterministic `RunSummary` and a matching trace stream.

**Rationale:**
Covers the e2e acceptance criterion. Reuses the FEAT-001 fixture infrastructure, so the spec stays small.

**Acceptance Criteria:**
- [ ] `e2e/start-run.spec.ts` passes locally and in CI.
- [ ] Spec covers: open form via CTA → agent appears in picker → submit → land on `/runs/:id` → trace timeline shows ≥1 record within 2s.
- [ ] Spec also asserts the malformed-JSON guard: typing `{not json` disables submit and shows the inline parse error.
- [ ] Upstream mock's `POST /v1/runs` returns `202` with the new `RunSummary` and registers a deterministic trace for the returned id.
- [ ] No flakiness across 3 consecutive local runs.

**Files to Modify/Create:**
- `e2e/start-run.spec.ts` — new.
- `e2e/fixtures/upstream-mock.ts` — add `POST /v1/runs` handler and matching trace registration.

**Technical Notes:**
- Reuse the `data-testid` conventions established in FEAT-001 for stable selectors; add new ids on the start-run template (`run-start-form`, `agent-picker`, `intake-editor`, `submit-button`, `intake-error`, `agent-error`).
- Do not introduce real upstream calls — the in-process mock is the contract surface for e2e.

---

## Polish

### T-028: Add `/runs/new` to Lighthouse a11y CI + update docs and changelogs

**Type:** DevOps + Documentation
**Workflow:** standard
**Complexity:** S
**Dependencies:** T-026

**Description:**
Add `http://localhost:4200/runs/new` to `lighthouserc.json`'s URL list and ensure the existing `puppeteerScript` logs in before auditing. Update `docs/ui-specification.md`, `docs/api-spec.md`, `docs/ARCHITECTURE.md`, and (if any new fields are introduced) `docs/data-model.md` with FEAT-002 changelog entries dated `2026-05-10`.

**Rationale:**
Keeps the a11y gate (≥0.95) covering every shipped screen, and satisfies the CLAUDE.md documentation-maintenance discipline.

**Acceptance Criteria:**
- [ ] `lighthouserc.json` audits `/login`, `/runs`, `/runs/:id`, **and** `/runs/new`; the score on `/runs/new` is ≥ 0.95 in CI.
- [ ] `docs/ui-specification.md` § "Screen: Run Start" reflects the as-built component (states, validation, error mapping) and adds a changelog row.
- [ ] `docs/api-spec.md` adds a changelog row noting that `POST /api/v1/runs` is now consumed by the SPA (no contract change expected; flag if any drift was found).
- [ ] `docs/ARCHITECTURE.md` adds a changelog row for the new feature folder `features/run-start/`.
- [ ] If a `StartRunRequest` field deviates from the data-model snapshot, `docs/data-model.md` is updated with a changelog row; otherwise this is explicitly noted as "no data-model change".

**Files to Modify/Create:**
- `lighthouserc.json` — add URL.
- `scripts/lhci-puppeteer-login.js` — confirm it handles `/runs/new` (it logs in for any non-`/login` URL, so likely no change).
- `docs/ui-specification.md`, `docs/api-spec.md`, `docs/ARCHITECTURE.md` — content + changelog rows.
- `docs/data-model.md` — only if drift is found.

**Technical Notes:**
- The Lighthouse workflow already boots the production build via the custom static server (`scripts/serve-spa-with-proxy.mjs`), so `/runs/new` will be a static route under SPA fallback — no workflow changes expected.
- Keep changelog entries terse: one row per file, dated, one-line description.

---

## Summary

**Total tasks:** 5
- Frontend: 3 (T-024, T-025, T-026)
- Testing: 1 (T-027)
- DevOps + Docs: 1 (T-028)

**Complexity distribution:** S × 3 (T-024, T-027, T-028), M × 2 (T-025, T-026). No L/XL — feature is intentionally small.

**Critical path:** T-024 → T-025 → T-026 → T-027 → T-028 (linear; no parallelism opportunities since each task layers on the previous one's output).

**Risks / open questions surfaced during analysis:**
- **`maxSteps` serialization** — confirm during T-026 whether the orchestrator accepts `budget: { maxSteps: undefined }`, omitted `budget`, or only `budget: { maxSteps: <int> }`. Likely "omit when blank"; verify with a real call before locking the unit test.
- **Agent-list freshness** — `AgentsService` may cache results from the runs-list page. T-025's empty-state refresh button should bypass the cache; confirm during implementation that the service exposes (or gains) a `refresh()` affordance rather than relying on page reload.
- **Mockup-first overhead** — the screen is a standard form, which the workflow rules technically exempt. We are keeping mockup-first because the CTA visibility and empty-state content benefit from a quick visual pass; if the mockup phase blocks progress, downgrading to `standard` mid-flight is acceptable as long as the deviation is recorded in the implementation plan.
- **Cancel button behavior** — T-025 uses `Location.back()`; if the user lands on `/runs/new` directly (deep link), there is no history entry and we fall back to `/runs`. Make sure the unit test covers both branches.
