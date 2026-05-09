# Implementation Plan: T-023 — Documentation updates and changelog entries

## Task Reference
- **Task ID:** T-023
- **Type:** Documentation
- **Workflow:** standard
- **Complexity:** S
- **Rationale:** "Documentation Maintenance Discipline" is a hard rule in `CLAUDE.md` — any change to data shapes, endpoints, screens, or system topology must be reflected in the matching doc, and every touched doc must carry a changelog entry. This task is the merge-day audit that catches drift from FEAT-001 implementation rather than leaving it for the next feature to discover.

## Overview
Walk the four maintenance docs (`docs/api-spec.md`, `docs/data-model.md`, `docs/ui-specification.md`, `docs/ARCHITECTURE.md`) against what FEAT-001 actually shipped. For each, diff the document's pre-implementation state against current code/specs and update only where reality drifted from the doc. Append a dated changelog entry to every doc that received a substantive change. This is a *review-and-update* checklist — there is no pre-determined diff; the actual edits depend on what surfaces during review.

## Implementation Steps

### Step 1: Audit `docs/api-spec.md`
**File:** `docs/api-spec.md`
**Action:** Modify (conditional)
Per `CLAUDE.md` Documentation Maintenance Discipline ("New / changed BFF or orchestrator endpoint" → `docs/api-spec.md`), review every BFF route shipped in FEAT-001:

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` — confirm the spec's request/response shapes (status codes, error `code` values, cookie attributes) match `bff/src/routes/auth.ts` from T-004.
- `GET /api/v1/runs` (list with `status`, `agentRef`, `page`, `pageSize`) — confirm query params, default `pageSize=20`, max `100`, and the `{ data, meta: { page, pageSize, total } }` envelope match `bff/src/routes/api-proxy.ts` from T-005 and `RunsService` from T-009.
- `GET /api/v1/runs/:id` — single-resource envelope `meta: null`.
- `GET /api/v1/runs/:id/trace?follow=true&since=&kind=` — confirm `Content-Type: application/x-ndjson`, `Transfer-Encoding: chunked`, `X-Accel-Buffering: no` are documented (per T-006 implementation).
- `POST /api/v1/runs/:id/signals/dispatch` — confirm 202 response, `meta.alreadyReceived` semantics, and the error catalog rows for `409 run-already-terminal`, `404 task-not-in-run-memory`, `422 invalid-signal-payload` per T-019.
- `POST /api/v1/runs/:id/cancel` — confirm `409 run-already-terminal` row.
- `GET /api/v1/agents` — confirm shape.

For each row in the error catalog, confirm the documented `code` matches the literal string the BFF passes through unchanged from the orchestrator. Update doc rows where strings drifted; do NOT change BFF code to match a stale doc — the orchestrator contract is authoritative per `CLAUDE.md` External Reference Repos.

If any change is made, append a row to the doc's Changelog section dated to merge day (see Step 5).

### Step 2: Audit `docs/data-model.md`
**File:** `docs/data-model.md`
**Action:** Modify (conditional)
Per `CLAUDE.md` ("New entity / field on the wire" → `docs/data-model.md`), diff the documented TS interfaces against `src/app/models/` (defined in T-003):

- `RunSummary`, `RunDetail` — every field listed in the doc table exists on the interface and vice versa.
- `TraceRecord` discriminated union — confirm all five `kind` variants (`step`, `executor_call`, `policy_call`, `webhook_event`, `effector_call`) are documented with their full field sets, especially `ExecutorCallRecord.state ∈ {dispatched, completed, failed}` and `mode ∈ {engine, local, remote, human}` since the awaiting-signal panel (T-019) keys off these.
- `SignalRequest`, `SignalReceipt` — body fields `commitSha`, `prUrl`, `diff?`, `implementationNotes`, and the `meta.alreadyReceived` field on the response.
- `Pagination`, `Envelope<T>`, `PaginatedEnvelope<T>` — confirm generics match the BFF response shape.
- `ProblemDetails` — confirm the `code` field is documented as required (it drives error toasts).
- `OperatorSession` — `{ authenticated, expiresAt }` per T-004.

If interfaces gained fields during implementation that weren't pre-anticipated (e.g. the trace stream service kept a `lastTimestamp` for resume per T-010 — a client-side concept, not a wire field), do NOT add them to `data-model.md`. The doc is the **wire shape**, not internal model state.

### Step 3: Audit `docs/ui-specification.md`
**File:** `docs/ui-specification.md`
**Action:** Modify (conditional)
Per `CLAUDE.md` ("New / changed screen or component" → `docs/ui-specification.md`), diff documented screens against shipped components:

- **§ Screen: Login** — confirm fields match `LoginComponent` from T-014: passphrase input, submit button, inline error slot, expired-session banner from `?reason=expired`.
- **§ Screen: Runs List** — confirm columns (`status badge`, `agentRef`, `intake`, `startedAt`, `lastStepNumber`), default filter `status=paused`, pagination, polling cadence (5s, paused on hidden tab) from T-016.
- **§ Screen: Run Detail** — confirm header, trace timeline (5 record kinds visually distinguished), awaiting-signal panel (visible only when latest `executor_call` is `dispatched + human`), Cancel button visibility rule (hidden when terminal) per T-018/T-019.
- **§ Cross-cutting Components** — toast service variants (success/info auto-dismiss 4s, error persists), full-page error with Retry, status badge color mapping (bg/text classes per § Status Badge Mapping), confirmation modal focus trap and Esc-close per T-011/T-012.
- **§ Behavior: Trace Stream** — confirm the documented behavior matches `TraceStreamService` from T-010 (fetch + ReadableStream, single reconnect with `since=`, abort on destroy).
- **§ Behavior: Auth Guard** — confirm `?redirect=` and `?reason=expired` semantics from T-008.
- **§ Design System** — confirm modern-minimal token references match what `tailwind.config.js` ships (T-002). If T-002 introduced any token deviation, reflect it here AND in `CLAUDE.md` Design System (per the maintenance row "New DDR adopted").

Note any `data-testid` additions from T-020 Step 8 — these are test hooks, not user-facing behavior, so they need NOT be documented in `ui-specification.md`. Keep the doc focused on user-observable behavior.

### Step 4: Audit `docs/ARCHITECTURE.md`
**File:** `docs/ARCHITECTURE.md`
**Action:** Modify (conditional)
Per `CLAUDE.md` ("New service or module" → `docs/ARCHITECTURE.md`), diff the system topology section against shipped code:

- **Component Architecture** — confirm `AuthService`, `ApiClient`, `RunsService`, `AgentsService`, `SignalsService`, `TraceStreamService`, `ToastService` all appear with one-line descriptions (T-007–T-011).
- **BFF Component Descriptions** — confirm cookie session middleware, generic `/api/v1/*` forwarder, dedicated `/api/v1/runs/:id/trace` streaming route are documented (T-004/T-005/T-006).
- **Data Flow** diagrams — confirm the read flow (runs list), trace stream flow (NDJSON pass-through with no buffering, `X-Accel-Buffering: no`), and signal submit flow (`202` + `meta.alreadyReceived` re-send semantics) are accurate.
- **Security Architecture** — confirm "API key never reaches browser" rationale references the gate added in T-022 (`scripts/check-no-secrets-in-bundle.sh`) and the Playwright header assertion. Add a one-line reference to those mechanisms — they are how the architectural property is enforced.
- **Integration Points** — confirm `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_API_KEY`, `ORCHESTRATOR_OPERATOR_PASSPHRASE`, `SESSION_SECRET` env vars are listed as the BFF's required inputs.

### Step 5: Append changelog entries to every touched doc
**Files:** `docs/api-spec.md`, `docs/data-model.md`, `docs/ui-specification.md`, `docs/ARCHITECTURE.md`
**Action:** Modify (conditional — only docs actually changed in Steps 1–4)
Per `CLAUDE.md` Documentation Maintenance Discipline ("Changelog rule"), every doc that received a substantive edit gets a new row in its Changelog section (already present at the bottom of each doc) with merge-day's date. Format follows existing entries — match style verbatim; do not introduce a new format.

Example (illustrative — actual entries depend on what was changed):
```
| 2026-MM-DD | FEAT-001 implementation pass | Reconciled error catalog `code` strings with BFF pass-through; clarified `meta.alreadyReceived` semantics on signal replay. |
```

If a doc had no substantive change in its Step 1–4 audit, do NOT add a changelog entry — the rule is "every update gets an entry", not "every release gets an entry per doc". An empty audit pass is a valid outcome and is captured in the PR description instead.

### Step 6: Cross-check `CLAUDE.md` itself for new conventions
**File:** `CLAUDE.md`
**Action:** Modify (conditional)
Per the maintenance table row "New convention → `CLAUDE.md`", review whether FEAT-001 introduced patterns that should be hoisted into `CLAUDE.md`:

- Did T-010 establish a specific NDJSON-parsing pattern (e.g. partial-line buffering helper) that future tasks should reuse?
- Did T-007's `ApiClient` envelope unwrap settle a convention worth promoting from "service detail" to "all services do it this way"?
- Did the `data-testid` naming added in T-020 Step 8 need a project-wide convention entry under Naming Conventions?

If yes, add a one- or two-line rule to the relevant section (Patterns, Naming Conventions, Anti-Patterns). Keep additions minimal — `CLAUDE.md` is read by every future task, so each line carries weight. If unsure, defer to a follow-up rather than over-document.

`CLAUDE.md` does not have a changelog section by default; do not add one in this task.

### Step 7: Owner review and sign-off
**File:** *(no file edit — review checkpoint)*
**Action:** Verify
Per the task's AC "Diff against pre-implementation state is reviewed by the owner before merge", request review from the doc owner (typically the FEAT-001 reviewer) on the resulting PR. The PR description should list which docs were touched and link to the matching `CLAUDE.md` maintenance-table rows that justified each change.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `docs/api-spec.md` | Modify (conditional) | Reconcile BFF endpoint shapes, error `code` rows, NDJSON streaming headers with shipped code; add changelog entry if changed. |
| `docs/data-model.md` | Modify (conditional) | Reconcile `RunSummary`/`RunDetail`/`TraceRecord` interfaces with `src/app/models/`; add changelog entry if changed. |
| `docs/ui-specification.md` | Modify (conditional) | Reconcile screen sections (Login/Runs List/Run Detail), cross-cutting components, trace-stream behavior with shipped UI; add changelog entry if changed. |
| `docs/ARCHITECTURE.md` | Modify (conditional) | Reconcile component listing, data flows, security rationale (citing T-022 gate); add changelog entry if changed. |
| `CLAUDE.md` | Modify (conditional) | Add any genuinely new conventions surfaced by FEAT-001 (e.g. NDJSON parsing pattern); no changelog entry required. |

## Edge Cases & Risks
- **Over-eager doc edits.** It is tempting to "polish" docs while reading them. Per the task brief, edits are review-and-update for *drift*, not stylistic cleanup. Out-of-scope edits inflate the PR and weaken the changelog signal.
- **Under-eager doc edits.** The opposite risk: the auditor sees a small drift, decides "close enough", and skips it. Mitigation: when in doubt, write the change and add a changelog row — drift compounds.
- **Wire-shape vs internal-state confusion.** `data-model.md` is the wire shape; client-only fields (e.g. resume timestamps in `TraceStreamService`) belong in code comments or `ARCHITECTURE.md`, not `data-model.md`. Easy to mis-classify.
- **Date stamping.** Use the merge date, not the PR-open date — the changelog reflects when the change landed on `main`. If the PR sits open across day boundaries, update the date right before merge.
- **Stakeholder definition is intentionally NOT in the audit list.** Per the maintenance table, `docs/stakeholder-definition.md` is touched only on **scope change**, which FEAT-001 by definition delivers within scope. Resist the urge to revise the stakeholder doc as part of this task.
- **External reference docs (`carestechs-software-architecture`, `carestechs-ui-design`, `carestechs-agent-orchestrator`)** are not in this repo and not in scope. If a drift originates from those repos (e.g. the orchestrator changed a `code` string), the fix lands there first; this audit only reconciles this repo's docs to whatever those upstream contracts now say.
- **Empty audit outcome is valid.** If no doc actually drifted, the PR for this task may end up empty. That is acceptable and should be recorded in the PR description with a brief "audited X, no drift found" note. Do not invent a changelog entry to make the PR feel more substantial.

## Acceptance Verification
- [ ] AC "Each of the four docs has a changelog entry dated to merge day if it was touched" — verified by visual diff of the Changelog table at the bottom of each of `docs/api-spec.md`, `docs/data-model.md`, `docs/ui-specification.md`, `docs/ARCHITECTURE.md`. A doc not touched in Steps 1–4 needs no entry; a doc touched must have an entry dated to merge day in the existing changelog format.
- [ ] AC "Diff against pre-implementation state is reviewed by the owner before merge" — verified by the PR carrying an explicit review approval from the doc owner (Step 7), with the PR description listing every doc changed and the `CLAUDE.md` maintenance-table row that justified each change.
