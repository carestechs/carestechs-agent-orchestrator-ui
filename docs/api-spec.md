# API Specification

## Overview

This document describes **the orchestrator API surface that the Angular SPA calls directly**. After FEAT-003 there is no BFF; the SPA attaches its own `Authorization: Bearer ${ORCHESTRATOR_API_KEY}` (read from `environment.*.ts`) and hits the orchestrator on every request.

When this document and `carestechs-agent-orchestrator/docs/api-spec.md` diverge on any `/api/v1/*` shape, the orchestrator's is authoritative.

## Conventions

- **Base URL:** `${environment.orchestratorBaseUrl}` — configured per environment in `src/environments/environment.*.ts`. All paths below are relative to that base.
- **Auth:** `Authorization: Bearer ${environment.orchestratorApiKey}` attached by the SPA's `ApiClient` and `TraceStreamService` on every request. The key value ships in the browser bundle by design (see `docs/ARCHITECTURE.md` § "Interim security posture").
- **JSON casing:** camelCase end-to-end.
- **Envelope:** every 2xx JSON response has `{ data, meta }`. `meta` is `null` for single resources, `{ page, pageSize, total }` for collections, and may carry `alreadyReceived` for idempotent re-sends.
- **Errors:** `application/problem+json` (RFC 7807) with stable `code` field.
- **Pagination:** offset-based — `?page=1&pageSize=20`. ADR `api/offset-pagination.md`.
- **Idempotency:** all writes are idempotent on a stable key. Retry freely; no client-side dedupe.

## Operator Gate (no API; SPA-only)

The login screen does **not** call the orchestrator. It compares the typed value against `environment.operatorPassphrase` and sets a `sessionStorage` flag (`ao.operator.unlocked`). The route guard reads the flag synchronously. A 401 from any orchestrator call clears the flag and redirects to `/login?reason=expired`.

There is no `/auth/*` surface anymore.

---

## Runs

### `GET /api/v1/runs`

List runs.

**Query:** `status` (`running|paused|completed|failed|cancelled`), `agentRef` (string), `page` (default 1), `pageSize` (default 20, max 100).

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "agentRef": "lifecycle-agent@0.3.0",
      "status": "paused",
      "intake": { "featureBriefPath": "docs/work-items/FEAT-042.md" },
      "startedAt": "2026-05-09T09:01:00Z",
      "endedAt": null,
      "lastStepNumber": 17,
      "terminationReason": null
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 53 }
}
```

### `GET /api/v1/runs/{runId}`

Run detail.

**Response 200:** `data` is a `RunDetail` (see `data-model.md`); `meta` is `null`.

### `POST /api/v1/runs`

Start a new run. Returns `202` immediately.

**Request:**
```json
{
  "agentRef": "lifecycle-agent@0.3.0",
  "intake": { "featureBriefPath": "docs/work-items/FEAT-042.md" },
  "budget": { "maxSteps": 200 }
}
```

**Response 202:** `data` is the new `RunSummary`. `meta` is `null`.

**Errors:** `400` (`code: invalid-intake`), `404` (`code: agent-not-found`).

### `POST /api/v1/runs/{runId}/cancel`

Cancel a non-terminal run.

**Response 202:** `data` is the updated `RunSummary` with `status: 'cancelled'`.

**Errors:** `409` (`code: run-already-terminal`).

### `POST /api/v1/runs/{runId}/signals`

The single human-pause write.

**Request:**
```json
{
  "name": "implementation-complete",
  "taskId": "T-001",
  "payload": {
    "commitSha": "abc1234",
    "prUrl": "https://github.com/org/repo/pull/42",
    "diff": "...optional...",
    "implementationNotes": "...free form..."
  }
}
```

**Response 202:**
```json
{
  "data": {
    "id": "...",
    "name": "implementation-complete",
    "taskId": "T-001",
    "payload": { "...": "..." },
    "receivedAt": "2026-05-09T10:12:34Z"
  },
  "meta": null
}
```

If the same `(runId, name, taskId)` is replayed, response is still `202` with `meta: { "alreadyReceived": true }`. Per BUG-011 in the orchestrator, the duplicate **still wakes** the active dispatch — safe to retry even mid corrections-loop.

**Errors:**
- `409` `code: run-already-terminal` — run is `completed`/`failed`/`cancelled`.
- `404` `code: task-not-in-run-memory` — `taskId` doesn't match any task the run knows about.
- `422` `code: invalid-signal-payload` — schema violation.

### `GET /api/v1/runs/{runId}/trace`  *(streaming NDJSON)*

Live trace tail.

**Query:**
- `follow=true|false` — keep the connection open until the run terminates. Default `false`.
- `since=<ISO-8601>` — emit only records after the timestamp.
- `kind=step|policy_call|webhook_event|executor_call|effector_call` — repeatable filter; omit for everything.

**Response 200:** `Content-Type: application/x-ndjson`. One JSON object per line, each a `TraceRecord` (see `data-model.md`).

**Streaming requirement:** any reverse proxy in front of the orchestrator must honor early-flush (e.g., nginx `X-Accel-Buffering: no`). The SPA opens the stream via `fetch` + `ReadableStream` and reads line-by-line; buffering at the orchestrator's hosting layer would defeat the live-trace UX.

### `GET /api/v1/runs/{runId}/steps`  *(forensics — v2)*

Paginated step list. Out of scope for v1; deferred.

### `GET /api/v1/runs/{runId}/policy-calls`  *(forensics — v2)*

Per-LLM-call audit. Out of scope for v1; deferred.

---

## Agents

### `GET /api/v1/agents`

List available agents (used to populate the start-run form).

**Response 200:**
```json
{
  "data": [
    {
      "ref": "lifecycle-agent@0.3.0",
      "description": "Drives a feature lifecycle from work item to merged implementation.",
      "nodes": [
        { "name": "load_work_item", "kind": "local" },
        { "name": "request_implementation", "kind": "human" },
        { "name": "review_implementation", "kind": "local" }
      ]
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 1 }
}
```

---

## Error Catalog

All errors use RFC 7807 with `code`. The UI's error toast keys on `code`; never on `status` alone.

| HTTP | `code` | When | UI Behavior |
|------|--------|------|-------------|
| 400 | `invalid-intake` | Start-run payload malformed | Inline form errors |
| 401 | `unauthenticated` | Orchestrator API key rotated/revoked | Lock the operator gate, redirect to `/login?reason=expired` |
| 403 | `forbidden` | Reserved (RBAC v2) | Toast |
| 404 | `run-not-found` | Unknown `runId` | Empty state on detail page |
| 404 | `agent-not-found` | Unknown `agentRef` on start-run | Inline error on agent picker |
| 404 | `task-not-in-run-memory` | Bad `taskId` on signal | Inline error on signal form, suggest re-pick |
| 409 | `run-already-terminal` | Cancel/signal on terminal run | Toast + auto-refresh run |
| 422 | `invalid-signal-payload` | Signal body fails validation | Inline form errors |
| 0 / Network | `unknown` | SPA cannot reach the orchestrator | Full-page error with retry |

---

## CORS

The SPA calls the orchestrator cross-origin. The orchestrator's CORS configuration must:

- Allow the SPA's deployed origin. For the **operator-local container topology** shipped with FEAT-005 this is `http://127.0.0.1:4200` (loopback bind on the container host). Also `http://localhost:4200` for dev.
- Include `authorization` and `content-type` in `Access-Control-Allow-Headers`.
- Allow `GET, POST, PUT, PATCH, DELETE, OPTIONS` in `Access-Control-Allow-Methods`.
- Respond to `OPTIONS` preflight on every method used by the SPA, including the streaming `GET /api/v1/runs/:id/trace`. The streaming endpoint's preflight is the most commonly missed; verify it explicitly.

The in-process e2e mock (`e2e/fixtures/upstream-mock.ts`) echoes the request `Origin` and sets allow-headers/methods accordingly; production orchestrators must do the equivalent.

`scripts/check-orchestrator-cors.sh` is a curl-based verification of the three preflight checks above and should be re-run after any orchestrator deployment topology change.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-09 | Initial spec — auth surface + `/api/v1/*` pass-through derived from `orchestrator-ui-starter.md`. |
| 2026-05-09 | FEAT-001 audit — confirmed BFF envelope shapes (`{ data, meta }` for resources, `{ data, meta: Pagination }` for collections), `application/x-ndjson` + `X-Accel-Buffering: no` on the trace pass-through, and that the error-catalog `code` strings flow through the BFF unchanged. |
| 2026-05-10 | FEAT-002 — `POST /api/v1/runs` is now consumed by the SPA from `/runs/new`. Contract unchanged. The SPA omits the `budget` key entirely when `maxSteps` is blank rather than sending `budget: { maxSteps: null }`. |
| 2026-05-10 | FEAT-002 — fixed BFF `/api/v1/*` JSON body forwarding. Fastify's default `application/json` parser was shadowing the custom buffer parser, so POST bodies were arriving as parsed objects and getting coerced to `"[object Object]"` when forwarded. `bff/src/server.ts` now calls `removeAllContentTypeParsers()` first; pass-through is now byte-correct as originally specified. |
| 2026-05-10 | FEAT-003 — BFF retired. SPA calls the orchestrator directly. All paths reframed from `/api/v1/*` to `/v1/*` against the orchestrator base URL. `/auth/*` endpoints removed entirely; operator gate is now SPA-side (no API). New CORS section spelling out the orchestrator requirements. 401 behavior repurposed to "orchestrator key rotation"; `upstream-unavailable` / `upstream-error` codes retired (the BFF that emitted them is gone — generic network failures now flow as `unknown`). |
| 2026-05-11 | FEAT-005 — CORS section names `http://127.0.0.1:4200` explicitly as the operator-local deployed origin. `scripts/check-orchestrator-cors.sh` referenced as the re-verification check. |
| 2026-05-11 | BUG-001 — all endpoint paths reframed from `/v1/*` back to `/api/v1/*` to match the real orchestrator (verified against its OpenAPI). The FEAT-003 reframe to bare `/v1/*` was incorrect; the `/api` prefix belongs to the orchestrator, not the retired BFF. SPA, e2e mock, scripts, and tests realigned in the same PR. |
