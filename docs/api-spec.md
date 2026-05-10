# API Specification

## Overview

This document describes **the surface the Angular SPA calls** — i.e., the BFF's public HTTP API. The BFF mounts two surfaces:

1. **`/auth/*`** — operator session lifecycle (BFF-owned).
2. **`/api/v1/*`** — pass-through proxy to `carestechs-agent-orchestrator` with the bearer key injected server-side. Shapes are identical to the orchestrator's API.

When this document and `carestechs-agent-orchestrator/docs/api-spec.md` diverge on any `/api/v1/*` shape, the orchestrator's is authoritative.

## Conventions

- **Base URL:** same-origin. The SPA always calls `/api/v1/...` and `/auth/...` against its own origin; the BFF resolves upstream.
- **Auth (browser ↔ BFF):** `httpOnly` session cookie. No bearer tokens in the browser.
- **Auth (BFF ↔ orchestrator):** `Authorization: Bearer ${ORCHESTRATOR_API_KEY}` injected by the BFF. Never sent to the browser.
- **JSON casing:** camelCase end-to-end.
- **Envelope:** every 2xx JSON response has `{ data, meta }`. `meta` is `null` for single resources, `{ page, pageSize, total }` for collections, and may carry `alreadyReceived` for idempotent re-sends.
- **Errors:** `application/problem+json` (RFC 7807) with stable `code` field. Passed through unchanged from the orchestrator.
- **Pagination:** offset-based — `?page=1&pageSize=20`. ADR `api/offset-pagination.md`.
- **Idempotency:** all writes are idempotent on a stable key. Retry freely.

## Auth (BFF-owned)

### `POST /auth/login`

Operator submits the shared passphrase, BFF establishes a session.

**Request:**
```json
{ "passphrase": "..." }
```

**Response 200:**
```json
{ "data": { "authenticated": true, "expiresAt": "2026-05-09T18:00:00Z" }, "meta": null }
```

**Errors:** `401` (`code: invalid-passphrase`).

### `POST /auth/logout`

Clears the session cookie. Always `204`.

### `GET /auth/me`

Returns the current operator session.

**Response 200:**
```json
{ "data": { "authenticated": true, "expiresAt": "2026-05-09T18:00:00Z" }, "meta": null }
```
Returns `{ authenticated: false }` (200) if no session — used by the SPA's auth guard.

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

**Implementation:** the BFF opens the upstream `fetch` and pipes the body straight to the response. No buffering, no transformation. Disable any compression that would block early-flush.

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
| 401 | `unauthenticated` | No / expired session | Redirect to `/login` |
| 401 | `invalid-passphrase` | Login failed | Login form error |
| 403 | `forbidden` | Reserved (RBAC v2) | Toast |
| 404 | `run-not-found` | Unknown `runId` | Empty state on detail page |
| 404 | `agent-not-found` | Unknown `agentRef` on start-run | Inline error on agent picker |
| 404 | `task-not-in-run-memory` | Bad `taskId` on signal | Inline error on signal form, suggest re-pick |
| 409 | `run-already-terminal` | Cancel/signal on terminal run | Toast + auto-refresh run |
| 422 | `invalid-signal-payload` | Signal body fails validation | Inline form errors |
| 500 | `upstream-unavailable` | BFF cannot reach orchestrator | Full-page error with retry |
| 502 | `upstream-error` | Orchestrator returned 5xx | Full-page error with retry |

---

## CORS

None. Same-origin only. The SPA is served from the same origin as the BFF.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-09 | Initial spec — auth surface + `/api/v1/*` pass-through derived from `orchestrator-ui-starter.md`. |
| 2026-05-09 | FEAT-001 audit — confirmed BFF envelope shapes (`{ data, meta }` for resources, `{ data, meta: Pagination }` for collections), `application/x-ndjson` + `X-Accel-Buffering: no` on the trace pass-through, and that the error-catalog `code` strings flow through the BFF unchanged. |
| 2026-05-10 | FEAT-002 — `POST /api/v1/runs` is now consumed by the SPA from `/runs/new`. Contract unchanged. The SPA omits the `budget` key entirely when `maxSteps` is blank rather than sending `budget: { maxSteps: null }`. |
| 2026-05-10 | FEAT-002 — fixed BFF `/api/v1/*` JSON body forwarding. Fastify's default `application/json` parser was shadowing the custom buffer parser, so POST bodies were arriving as parsed objects and getting coerced to `"[object Object]"` when forwarded. `bff/src/server.ts` now calls `removeAllContentTypeParsers()` first; pass-through is now byte-correct as originally specified. |
