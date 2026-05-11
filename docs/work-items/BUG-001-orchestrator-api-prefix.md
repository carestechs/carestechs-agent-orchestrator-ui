# BUG-001 — SPA hits `/v1/*` but orchestrator serves `/api/v1/*`

## Status
Open — 2026-05-11.

## Summary
The SPA calls the orchestrator at `${orchestratorBaseUrl}/v1/...` (e.g. `GET http://127.0.0.1:8000/v1/runs`) and every request returns `404 Not Found`. The real orchestrator (as documented by its OpenAPI at `http://127.0.0.1:8000/openapi.json`) mounts the API under `/api/v1/*`. The bare `/v1/*` paths have never existed upstream; the SPA has been non-functional against the real orchestrator since FEAT-003 retired the BFF.

## Reproduction
With the orchestrator running on `127.0.0.1:8000`:

```bash
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/v1/agents
404
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/api/v1/agents
401   # auth required — path exists
$ curl -s http://127.0.0.1:8000/openapi.json | head -c 300
# ...paths show /api/v1/runs, /api/v1/agents, etc.
```

## Root Cause
During FEAT-003 (BFF retirement) we reframed the SPA's path constants from `/api/v1/*` (the pre-FEAT-003 BFF-mounted prefix that *happened* to match the orchestrator) to `/v1/*`, on the mistaken assumption that the `/api` prefix was the BFF's contribution. It was not — the orchestrator itself serves under `/api/v1`. The SPA's `docs/api-spec.md`, all four resource services, the e2e upstream mock, both readiness scripts, and the unit tests all drifted to the bare `/v1/*` shape together, so no internal check caught it. The bug only surfaces when pointed at the real orchestrator.

## Acceptance Criteria
- `RunsService`, `AgentsService`, `SignalsService`, `TraceStreamService` all hit `/api/v1/...`.
- Unit specs assert the new path shape (`api-client.spec`, `runs.service.spec`, `agents.service.spec`, `signals.service.spec`, `run-detail.component.spec`).
- `e2e/fixtures/upstream-mock.ts` registers all routes under `/api/v1/*`; existing e2e suites pass against it.
- `scripts/smoke-prod.sh` and `scripts/check-orchestrator-cors.sh` probe `/api/v1/agents` (and the trace preflight under `/api/v1/runs/:id/trace`).
- `docs/api-spec.md` paths reframed from `/v1/*` to `/api/v1/*` with a changelog row.
- Sanity grep: `git grep -nE '"/v1/|''/v1/|`/v1/'` returns no hits in `src/`, `e2e/`, `scripts/`, or `docs/`.

## Out of Scope
- Folding `/api` into `orchestratorBaseUrl` instead. Rejected: it would make `docs/api-spec.md` paths misleading and require operators to encode application-layer routing in an infra-layer env var.
- Realigning the orchestrator to drop the `/api` prefix. Upstream owns its own URL space; the SPA is the consumer.
- Adding an integration test that hits a real orchestrator. The unit + e2e tests now match the wire shape; a real-orchestrator probe is `scripts/smoke-prod.sh`, which this PR updates.

## Files to Modify
- `src/app/core/runs.service.ts`
- `src/app/core/agents.service.ts`
- `src/app/core/signals.service.ts`
- `src/app/core/trace-stream.service.ts`
- `src/app/core/api-client.spec.ts`
- `src/app/core/runs.service.spec.ts`
- `src/app/core/agents.service.spec.ts`
- `src/app/core/signals.service.spec.ts`
- `src/app/features/run-detail/run-detail.component.spec.ts`
- `e2e/fixtures/upstream-mock.ts`
- `scripts/smoke-prod.sh`
- `scripts/check-orchestrator-cors.sh`
- `docs/api-spec.md`
