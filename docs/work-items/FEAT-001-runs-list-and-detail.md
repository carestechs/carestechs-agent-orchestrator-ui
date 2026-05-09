# FEAT-001 — Runs list and live run detail (v1 core loop)

**Status:** Proposed
**Owner:** TBD
**Workflow:** mockup-first
**Priority:** P0 (this is the v1 critical path)

## Summary

Deliver the operator's core loop: list paused runs, open a run, watch its live trace, submit the awaited `implementation-complete` signal, and cancel a run. This is the smallest cut that justifies the project's existence; everything else (start-run form, forensics) builds on top.

## Why

Per `docs/stakeholder-definition.md`, the success criterion is: open list → open run → submit signal in under 30 seconds. Today operators do this with `curl` + `jq`. This feature replaces that loop.

## In Scope

- `/login` screen with passphrase (BFF session cookie).
- `/runs` list screen with default filter `status=paused`, agentRef filter, offset pagination, auto-refresh polling.
- `/runs/:id` detail screen with:
  - Header (id, agentRef, intake, status badge, Cancel button).
  - Live NDJSON trace timeline (`fetch` + `ReadableStream`).
  - Awaiting-signal panel pre-filled from the last `executor_call` with `state=dispatched, mode=human`.
  - `POST /signals` submit, success toast, error handling for `404` / `409` / `422`.
- Cancel run with confirmation modal.
- BFF endpoints: `/auth/login`, `/auth/logout`, `/auth/me`, plus `/api/v1/*` pass-through (incl. NDJSON streaming).
- Modern-minimal design tokens applied via Tailwind config + `src/styles.css`.

## Out of Scope

- Start-run screen (FEAT-002).
- Forensics tabs (steps, policy-calls).
- Per-user RBAC.
- Multi-orchestrator switching.

## Acceptance Criteria

- [ ] An authenticated operator lands on `/runs` and sees paused runs by default.
- [ ] Clicking a paused run opens `/runs/:id` and the trace begins streaming within 1s.
- [ ] The signal form is visible only when the run is paused with an awaiting human dispatch, and pre-fills `taskId` correctly.
- [ ] Submitting a valid signal returns `202`, the trace continues advancing, and a success toast appears.
- [ ] Re-submitting the same signal shows a "received already" notice (`meta.alreadyReceived=true`) without breaking the UI.
- [ ] Cancelling a run sets status to `cancelled` after confirmation.
- [ ] No `Authorization` header or API key value is present in browser network logs or the JS bundle.
- [ ] The page degrades gracefully when the BFF returns `502 upstream-unavailable` (full-page error with retry).
- [ ] Lighthouse a11y score ≥ 95 on `/runs` and `/runs/:id`.

## Entity Impact

Models needed (per `docs/data-model.md`): `RunSummary`, `RunDetail`, `TraceRecord` and variants, `SignalRequest`, `SignalReceipt`, `Pagination`, `ProblemDetails`, `OperatorSession`.

## API Impact

All endpoints already exist in the orchestrator. The BFF must expose:
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.
- `GET /api/v1/runs`, `GET /api/v1/runs/:id`, `POST /api/v1/runs/:id/cancel`, `POST /api/v1/runs/:id/signals`.
- `GET /api/v1/runs/:id/trace` — NDJSON pass-through with `pipeline()`.
- `GET /api/v1/agents` (used by the agent filter on the list page).

## UI Impact

Three screens (`Login`, `RunsList`, `RunDetail`) and the cross-cutting toast/modal/empty-state components defined in `docs/ui-specification.md`.

## Risks / Open Questions

- NDJSON streaming through Node + ingress: confirm no buffering layer collapses the stream. Test with a long-running run before locking the deployment topology.
- Session expiry mid-stream: a `401` mid-trace should cleanly close and redirect to `/login?reason=expired`. Cover in tests.

## Traceability

- Stakeholder: `docs/stakeholder-definition.md` § "In Scope (v1)" rows 1–5.
- Architecture: `docs/ARCHITECTURE.md` § "Data Flow".
- API: `docs/api-spec.md` Auth + Runs sections.
- UI: `docs/ui-specification.md` § "Screen: Login", "Screen: Runs List", "Screen: Run Detail".
