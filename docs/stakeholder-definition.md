# Stakeholder Definition — carestechs-agent-orchestrator-ui

## Product Vision

A focused operator console for `carestechs-agent-orchestrator`. The orchestrator is intentionally headless; this UI exists to give a human operator (a) visibility into runs and (b) a frictionless way to deliver the one signal the lifecycle waits on (`implementation-complete`). Everything else — work-item dashboards, RBAC, multi-tenant features — is explicitly out of scope for v1.

## Why Build It

The orchestrator's `docs/stakeholder-definition.md` includes a **Scope Lock**: any UI lives in a separate consumer repo. This project is that repo. The pain it removes:

- Operators currently read NDJSON traces in a terminal to find which task is waiting on them.
- Operators hand-craft `curl` POSTs against `/api/v1/runs/{id}/signals`, mistyping `taskId` regularly.
- Runs sit paused longer than they should because the babysitting cost is too high.

## Primary Persona

The Lifecycle Operator. See `docs/personas/primary-user.md`. Single-user mental model — there is no per-user RBAC in v1.

## In Scope (v1)

| Capability | Note |
|------------|------|
| List runs with filters (`status`, `agentRef`) and pagination | Powered by `GET /api/v1/runs`. |
| Run detail view with live trace tail | Streams `GET /api/v1/runs/{id}/trace?follow=true`. |
| Identify the awaiting human dispatch and prefill the signal form | Reads the last `executor_call` whose state is `dispatched` and mode is `human`. |
| Submit `implementation-complete` signal | `POST /api/v1/runs/{id}/signals`. |
| Cancel a run | `POST /api/v1/runs/{id}/cancel`. Always reachable on non-terminal runs. |
| Start a new run | `POST /api/v1/runs`. Form picks an agent from `GET /api/v1/agents` and accepts an intake JSON. |
| List agents | `GET /api/v1/agents`, used by the start-run form. |

## Out of Scope (v1)

- Per-user identity / RBAC. The orchestrator has a single bearer key. **Real per-operator auth is deferred to FEAT-004**, owned by the orchestrator team; until then the SPA gates only on a shared operator passphrase and the orchestrator authenticates with a single shared API key bundled in the SPA. See `docs/ARCHITECTURE.md` § "Interim security posture".
- Work-item dashboards (`/api/v1/work-items` is not exposed by the orchestrator).
- Per-task drill-downs sourced from a `tasks` endpoint (also not exposed).
- Forensics views beyond the live trace — `/steps` and `/policy-calls` lookups are deferred to v2.
- Editing or replaying runs. The UI never mutates trace records.
- Multi-orchestrator switching. v1 targets a single configured base URL.

## Constraints That Shape The Product

1. **Interim auth.** The orchestrator API key is bundled into the SPA. This is acceptable **only because the orchestrator deployment is network-gated** (not publicly reachable). Operators are gated by a SPA-side passphrase stored in `sessionStorage` — zero real security value, just keeps casual tab-takeover from being a free action. Real per-operator auth is **FEAT-004**, owned by the orchestrator team. See `docs/ARCHITECTURE.md` § "Interim security posture".
2. **CORS required.** The orchestrator must allow the SPA's origin and the `authorization` header. The SPA calls `/api/v1/*` directly; there is no proxy in between.
3. **NDJSON streaming.** The trace endpoint is plain NDJSON over HTTP, not WebSocket / SSE. The UI consumes it via `fetch` + `ReadableStream`.
4. **Idempotent writes.** Signals are idempotent on `(runId, name, taskId)`. Retry freely; do not dedupe in the UI.
5. **CamelCase wire shapes.** All orchestrator JSON is camelCase; the UI matches at the boundary.
6. **Snapshot-only contract.** `orchestrator-ui-starter.md` is a curated subset; the orchestrator's `docs/api-spec.md` and `docs/data-model.md` are authoritative when shapes diverge.

## Success Criteria

- An operator can move a paused run forward (open list → open run → submit signal) in under 30 seconds.
- Trace tail keeps up with a live run with no perceived lag at default budgets.
- No accidental leaks of non-bundle-allowed secrets in the SPA bundle. The bundle-leak gate (`scripts/check-no-secrets-in-bundle.sh`) enforces this; the orchestrator API key and operator passphrase are *expected* in the bundle by design.
- The UI degrades gracefully when the orchestrator is offline (clear error state, no spinning forever).

## Release Model

Continuous development — no semantic versioning of the UI itself. The contract that matters is the orchestrator API version it targets (currently `v1`). When the orchestrator API changes, this UI's `docs/api-spec.md` and `docs/data-model.md` are updated and a changelog entry is added.

## Open Questions / Future Work

- **FEAT-004 — real per-operator auth at the orchestrator.** When this lands, the SPA drops the passphrase gate, stops bundling the API key, and consumes per-operator tokens issued by a real login flow. Until then the interim posture stands.
- Adding `GET /api/v1/work-items` upstream would unlock a much richer "what's in flight" view; flag if/when that lands.
- WebSocket / SSE on the orchestrator would simplify the trace tail but is not currently planned.
- Reviewer identity (`LIFECYCLE_REVIEWER`) is not surfaced in the trace today; a future trace enhancement may expose it.

## Changelog

| Date | Change |
|------|--------|
| 2026-05-09 | Initial stakeholder definition seeded from `orchestrator-ui-starter.md`. |
| 2026-05-10 | FEAT-003 — BFF retired. Constraints section rewritten to name the network-gating assumption and the SPA-side passphrase gate. Out-of-scope row added explicitly pointing at FEAT-004 (real per-operator auth at the orchestrator). All `/api/v1/*` paths reframed to `/v1/*`. |
| 2026-05-11 | BUG-001 — endpoint references reverted to `/api/v1/*` to match the real orchestrator prefix. The FEAT-003 reframe to bare `/v1/*` was incorrect; verified against the orchestrator's OpenAPI. |
