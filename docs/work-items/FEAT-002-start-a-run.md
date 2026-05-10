# FEAT-002 — Start a run

**Status:** Proposed
**Owner:** TBD
**Workflow:** mockup-first
**Priority:** P1 (closes the operator loop end-to-end)

## Summary

Deliver the `RunStartComponent` at `/runs/new`: pick an agent, supply an intake JSON payload, optionally cap `maxSteps`, submit, and land on the new run's detail page. Today the UI shipped in FEAT-001 lets an operator observe and signal runs but not create them — they still need `curl` for that single step. This feature closes the loop.

## Why

Per `docs/stakeholder-definition.md` and `docs/ui-specification.md` § "Screen: Run Start", starting a run is in v1 scope. It was deferred from FEAT-001 to keep that PR focused on the read-and-signal critical path; the route, link, and empty-state CTA all already point at `/runs/new` and currently dead-end. Shipping this turns the UI into a self-sufficient tool.

## In Scope

- `/runs/new` screen (`RunStartComponent`, standalone, signal-backed):
  - Agent picker populated from `GET /api/v1/agents` (reuse `AgentsService`).
  - Intake JSON editor — `<textarea>` with monospace styling, client-side `JSON.parse` validation, inline parse-error display, "format" button (pretty-print on demand).
  - Optional `budget.maxSteps` numeric input (positive integer, blank = orchestrator default).
  - Submit (`Start run`) and Cancel.
  - On `202`, redirect to `/runs/:id` for the returned `RunSummary.id`.
- Wire-up of the existing "Start a run" CTAs (header link on `/runs`, empty-state CTA) to actually navigate.
- `RunsService.startRun(payload)` calling `POST /api/v1/runs`.
- Error mapping: `400 invalid-intake` → field-level error on the intake editor; `404 agent-not-found` → inline error on the agent picker; network/`502` → full-page error with retry.
- Auth-guarded route (`canMatch:[authGuard]`), same as the rest of `/runs/*`.

## Out of Scope

- Schema-aware intake editor (Monaco / JSON-schema autocomplete). The textarea is good enough for v1; revisit if operators ask.
- Saved-payload history or templating.
- Multi-agent batch starts.
- Per-agent intake hints / examples (would need orchestrator-side metadata we don't yet expose).

## Acceptance Criteria

- [ ] An authenticated operator can navigate to `/runs/new` from `/runs` (header CTA and empty-state CTA both route there).
- [ ] The agent picker loads agents via `AgentsService` and shows a friendly empty state if zero agents are registered.
- [ ] Submitting with malformed JSON in the intake field shows an inline parse error and does not call the BFF.
- [ ] Submitting valid input calls `POST /api/v1/runs` exactly once and, on `202`, navigates to `/runs/:id` for the returned run.
- [ ] `400 invalid-intake` errors surface as a field-level message on the intake editor without losing the typed payload.
- [ ] `404 agent-not-found` errors surface on the agent picker with a "refresh agents" affordance.
- [ ] The submit button is disabled while submitting and re-enables on error so the operator can retry.
- [ ] Network / `502 upstream-unavailable` shows the standard `app-error-state` with retry, not a silent failure.
- [ ] Lighthouse a11y score ≥ 0.95 on `/runs/new` (extends the existing CI gate).
- [ ] Playwright smoke covers: open form → pick agent → submit → land on `/runs/:id` and trace begins streaming.

## Entity Impact

No new wire types. Reuses `RunSummary`, `ProblemDetails`. Introduces an internal `StartRunRequest` interface in `src/app/models/` to mirror the `POST /runs` request body. No `docs/data-model.md` changes expected — confirm during implementation.

## API Impact

`POST /api/v1/runs` already exists upstream and the BFF pass-through covers it. No new BFF routes. Update `docs/api-spec.md` only if anything about the request/response is found to differ from the current spec during implementation.

## UI Impact

- New screen `/runs/new` (`RunStartComponent`) — already declared in `docs/ui-specification.md`; no spec change needed unless the implementation diverges.
- Re-enables the previously dead CTAs on `/runs`.

## Risks / Open Questions

- **Intake schema surface area is unbounded.** Different agents accept very different payloads, and we have no machine-readable schema. We're shipping a free-form JSON textarea; operators will have to know what to type. Acceptable for v1; flag for product feedback.
- **`maxSteps` default.** If left blank, do we send `budget: undefined` or omit the key entirely? Confirm with orchestrator's `POST /runs` parser — sending `null` may fail validation.
- **Race on agent list staleness.** Agents are cached in `AgentsService`; if a freshly-registered agent doesn't appear, we need a manual refresh button (already covered via the `404 agent-not-found` recovery path, but worth surfacing in the empty state too).

## Estimated Tasks

Probably 3–5 task definitions, in this shape:

- T-024 `RunStartComponent` scaffold + route wiring + CTA re-enabling.
- T-025 Agent picker + intake JSON editor + client-side validation.
- T-026 `RunsService.startRun` + submit flow + error mapping (400 / 404 / 502).
- T-027 Playwright smoke for the start-run flow.
- T-028 Lighthouse URL added to `lighthouserc.json`; docs changelogs updated.

(Task generation will follow the routing in `CLAUDE.md` and `.ai-framework/prompts/feature-tasks.md`.)

## Traceability

- Stakeholder: `docs/stakeholder-definition.md` § "In Scope (v1)" — start-a-run row.
- API: `docs/api-spec.md` § `POST /api/v1/runs`.
- UI: `docs/ui-specification.md` § "Screen: Run Start (`/runs/new`)".
- Architecture: `docs/ARCHITECTURE.md` § "Data Flow" — same auth-guarded BFF pass-through pattern as the rest of the runs surface.
