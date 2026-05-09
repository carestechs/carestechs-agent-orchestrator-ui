# Implementation Plan: T-009 — Resource services: RunsService, AgentsService, SignalsService

## Task Reference
- **Task ID:** T-009
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** M
- **Rationale:** Components must consume services, not raw HTTP — keeps wire shapes and error mapping in one place. Per `CLAUDE.md` "Patterns to Follow": "One service per resource in core/. Components consume services; services own HTTP."

## Overview
Create three thin resource services in `src/app/core/` — one per orchestrator resource — that delegate every JSON call to `ApiClient` (T-007). They translate typed parameters into `/api/v1/*` URLs, decode the typed envelope, and surface the `meta` block where it matters (pagination on list endpoints; `alreadyReceived` on signal submission). Per `CLAUDE.md` Anti-Patterns: services do **not** use raw `fetch` here — that's reserved for the trace stream (T-010).

## Implementation Steps

### Step 1: Define a small pagination-input helper
**File:** `src/app/core/pagination.ts`
**Action:** Create
Export `DEFAULT_PAGE_SIZE = 20` and `MAX_PAGE_SIZE = 100` constants (UPPER_SNAKE per `CLAUDE.md` Naming Conventions). Export a `clampPageSize(n: number | undefined): number` function that:
- Returns `DEFAULT_PAGE_SIZE` when `n` is `undefined`/`NaN`/`<1`.
- Returns `MAX_PAGE_SIZE` when `n > MAX_PAGE_SIZE`.
- Otherwise returns `Math.floor(n)`.

This satisfies the AC "Default page size is 20, max 100, validated client-side before request". Keeping it as a pure function (per `CLAUDE.md` "Functional composition over classes" for non-Angular utilities) makes it trivially unit-testable from each service's spec.

### Step 2: Implement `RunsService`
**File:** `src/app/core/runs.service.ts`
**Action:** Create
`@Injectable({ providedIn: 'root' })`, named export `RunsService`. Inject `ApiClient`.

Methods:

```ts
list(filters?: {
  status?: RunStatus;
  agentRef?: string;
  page?: number;
  pageSize?: number;
}): Observable<{ data: RunSummary[]; meta: Pagination }>;

get(runId: string): Observable<RunDetail>;

cancel(runId: string): Observable<RunSummary>;
```

Implementation notes:
- `list`: build a params object `{ status, agentRef, page: filters?.page ?? 1, pageSize: clampPageSize(filters?.pageSize) }`. Strip `undefined` keys before calling `apiClient.get<RunSummary[]>('/api/v1/runs', params)`. Return the raw `{ data, meta }` (callers need pagination from `meta`).
- `get`: `apiClient.get<RunDetail>('/api/v1/runs/' + encodeURIComponent(runId))`, `.pipe(map(({ data }) => data))` — `meta` is `null` per `docs/api-spec.md`, callers don't need it.
- `cancel`: `apiClient.post<RunSummary>('/api/v1/runs/' + encodeURIComponent(runId) + '/cancel', {})`. Returns the updated `RunSummary` with `status: 'cancelled'` per spec. `409 run-already-terminal` flows out as a `ProblemDetailsError`; the run-detail screen (T-018) catches it and shows a toast — this service does not retry.
- Use models from `src/app/models/run.model.ts` and `api.model.ts` (T-003).

### Step 3: Implement `AgentsService`
**File:** `src/app/core/agents.service.ts`
**Action:** Create
`@Injectable({ providedIn: 'root' })`, named export `AgentsService`.

```ts
list(): Observable<Agent[]>;
```

- Calls `apiClient.get<Agent[]>('/api/v1/agents')`, `.pipe(map(({ data }) => data))`.
- For v1 the orchestrator returns 1–5 agents per FEAT-001 risks — no pagination params needed. If/when cardinality grows, this method gets the same shape as `runs.list`. Document that intent in a code comment but do not implement now.

### Step 4: Implement `SignalsService`
**File:** `src/app/core/signals.service.ts`
**Action:** Create
`@Injectable({ providedIn: 'root' })`, named export `SignalsService`.

```ts
submit(runId: string, body: SignalRequest): Observable<{ data: SignalReceipt; alreadyReceived: boolean }>;
```

- Calls `apiClient.post<SignalReceipt>('/api/v1/runs/' + encodeURIComponent(runId) + '/signals', body)`.
- Maps the envelope to `{ data: SignalReceipt, alreadyReceived: meta?.alreadyReceived === true }` so the run-detail screen (T-019) can pick the right toast copy ("Signal received" vs "Signal already received") without re-parsing `meta`. Satisfies AC "SignalsService.submit surfaces meta.alreadyReceived to callers".
- Use `SignalRequest` / `SignalReceipt` from `src/app/models/signal.model.ts`.
- Per `CLAUDE.md` Patterns "Idempotent retries — let the user retry freely. Do not dedupe client-side." — this service does NOT track in-flight submissions or guard against double-submit. The component disables its button while in flight (T-019).

### Step 5: Per-service unit tests
**File:** `src/app/core/runs.service.spec.ts`
**Action:** Create
Vitest with `HttpTestingController`. For each `RunsService` method, assert:
- URL and HTTP method are exactly right (`GET /api/v1/runs`, `GET /api/v1/runs/abc`, `POST /api/v1/runs/abc/cancel`).
- Query params: `list({ status: 'paused', agentRef: 'lifecycle-agent@0.3.0', page: 2, pageSize: 50 })` produces `?status=paused&agentRef=...&page=2&pageSize=50`.
- `pageSize` clamping: 0 → 20; 500 → 100; `undefined` → 20.
- `list({})` omits `status` and `agentRef` query params entirely (no `?status=undefined`).
- `runId` is URL-encoded (e.g. a UUID containing no special chars passes through; spec includes a `runId` with a `:` to confirm encoding, even though orchestrator IDs are UUIDs — defends against drift).
- Response decoding against a fixture matching `docs/api-spec.md` § Runs.

**File:** `src/app/core/agents.service.spec.ts`
**Action:** Create
Asserts `GET /api/v1/agents`, decoded shape against the fixture in `docs/api-spec.md` § Agents.

**File:** `src/app/core/signals.service.spec.ts`
**Action:** Create
- Successful submit → `alreadyReceived: false`, body decoded as `SignalReceipt`.
- Replay (`meta: { alreadyReceived: true }`) → `alreadyReceived: true`, same `SignalReceipt`.
- Body shape sent matches `SignalRequest` exactly (camelCase end-to-end per `CLAUDE.md` Patterns).
- 409 problem+json from `ApiClient` (T-007) propagates as `ProblemDetailsError` with `code === 'run-already-terminal'` — service does not catch.

All three spec files co-located per `CLAUDE.md` Testing Conventions ("Test location: Co-located"); naming `*.spec.ts`.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `src/app/core/pagination.ts` | Create | `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`, `clampPageSize`. |
| `src/app/core/runs.service.ts` | Create | `list`, `get`, `cancel` against `/api/v1/runs`. |
| `src/app/core/agents.service.ts` | Create | `list` against `/api/v1/agents`. |
| `src/app/core/signals.service.ts` | Create | `submit` against `/api/v1/runs/:id/signals`; surfaces `alreadyReceived`. |
| `src/app/core/runs.service.spec.ts` | Create | URL/params/decoding/clamp coverage. |
| `src/app/core/agents.service.spec.ts` | Create | URL/decoding coverage. |
| `src/app/core/signals.service.spec.ts` | Create | Success + replay + propagated 409. |

## Edge Cases & Risks
- **`runId` containing characters that break URL parsing.** Always use `encodeURIComponent`. Today the orchestrator emits UUIDs (no special chars), but defensive encoding costs nothing and is asserted in spec.
- **`pageSize` as float.** `clampPageSize` floors the value; component-level inputs should already be integers but services must not pass `?pageSize=20.5`.
- **`409 run-already-terminal` on cancel.** Per `CLAUDE.md` Error Handling: "Show a toast, refresh the run, do not retry." `RunsService` deliberately does not catch — the run-detail screen (T-018) handles this. Document this hand-off in a comment on `cancel()`.
- **No client-side dedupe of signals.** Per `CLAUDE.md` Patterns "Idempotent retries". The orchestrator's idempotency key `(runId, name, taskId)` returns `meta.alreadyReceived: true` on replay; that's what we surface.
- **`meta` typing on `list`.** `Pagination` is the right shape per `docs/data-model.md`, but `ApiClient.get<T>` returns `meta: unknown`. Cast at the service boundary using a tiny type guard (function `isPagination(x: unknown): x is Pagination`) rather than blind cast — keeps the "no `any` past the service layer" boundary rule intact (`CLAUDE.md` Patterns "Boundary types").

## Acceptance Verification
- [ ] AC "Each method has a unit test asserting URL, query params, and response decoding against a fixture" — Steps 5a–5c cover every method.
- [ ] AC "SignalsService.submit surfaces meta.alreadyReceived to callers" — Step 4 return shape; verified by the replay spec in Step 5c.
- [ ] AC "Default page size is 20, max 100, validated client-side before request" — `clampPageSize` (Step 1) plus the clamp spec cases in Step 5a.
- [ ] Convention check: services own HTTP via `ApiClient` (no raw `fetch`), one service per resource, named exports, no NgModules — verified against `CLAUDE.md` Patterns "One service per resource" and Anti-Patterns "Don't call the orchestrator directly from the browser".
