# Data Model

## Overview

The UI is a stateless consumer — it does not own any persistent entities. This document defines the **TypeScript view models** the SPA uses to render orchestrator data. Wire shapes are camelCase JSON over HTTP from the orchestrator (passed through unchanged by the BFF).

When this document and `carestechs-agent-orchestrator/docs/data-model.md` diverge, the orchestrator's is authoritative. Update this file and add a changelog entry.

All interfaces live in `src/app/models/`.

---

## Entities

### `RunSummary`

A row in the runs list. From `GET /api/v1/runs`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` (UUID) | Primary key |
| `agentRef` | `string` | e.g. `lifecycle-agent@0.3.0` |
| `status` | `RunStatus` | enum below |
| `intake` | `RunIntake` | Object describing the work item driving the run |
| `startedAt` | `string` (ISO-8601) | |
| `endedAt` | `string \| null` | Set when status is terminal |
| `lastStepNumber` | `number \| null` | Useful for progress rendering |
| `terminationReason` | `TerminationReason \| null` | See enum below; only set when terminal |

```ts
export type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type TerminationReason =
  | 'done_node'
  | 'policy_terminated'
  | 'budget_exceeded'
  | 'correction_budget_exceeded'
  | 'error'
  | 'cancelled';

export interface RunIntake {
  featureBriefPath?: string;
  // Other fields are agent-specific; treat as opaque map for unknown agents.
  [key: string]: unknown;
}

export interface RunSummary {
  id: string;
  agentRef: string;
  status: RunStatus;
  intake: RunIntake;
  startedAt: string;
  endedAt: string | null;
  lastStepNumber: number | null;
  terminationReason: TerminationReason | null;
}
```

### `RunDetail`

From `GET /api/v1/runs/{runId}`. Superset of `RunSummary`.

| Field | Type | Notes |
|-------|------|-------|
| _all of `RunSummary`_ | | |
| `traceUri` | `string` | Path to the trace endpoint (relative to API root) |
| `budget` | `RunBudget` | Soft limits |
| `currentNode` | `string \| null` | Last node dispatched, if any |

```ts
export interface RunBudget {
  maxSteps: number;
  maxTokens?: number;
}

export interface RunDetail extends RunSummary {
  traceUri: string;
  budget: RunBudget;
  currentNode: string | null;
}
```

### `TraceRecord` (discriminated union)

One JSON object per line of the NDJSON trace stream. Discriminated on `kind`. Every record uses an envelope shape: `{ kind, data: { ... } }`. Kind-specific fields live inside `data` and each kind has its own timestamp field(s); there is no unified `occurredAt`. Use `src/app/core/trace-helpers.ts` for the kind-aware accessors.

The main trace stream emits **four kinds**. The orchestrator also writes `executor_call` and `effector_call` records but to **separate** JSONL streams (`<trace_dir>/executors/…`, `<trace_dir>/effectors/…`) — those are out of scope for this stream and have no presence in the SPA today.

```ts
export type TraceRecord =
  | StepRecord
  | PolicyCallRecord
  | WebhookEventRecord
  | OperatorSignalRecord;

export type StepStatus = 'pending' | 'dispatched' | 'in_progress' | 'completed' | 'failed';

export interface StepRecord {
  kind: 'step';
  data: {
    id: string;             // UUID
    stepNumber: number;
    nodeName: string;
    status: StepStatus;
    nodeInputs: Record<string, unknown>;
    nodeResult: Record<string, unknown> | null;
    error: Record<string, unknown> | null;
    dispatchedAt: string | null;  // ISO-8601
    completedAt: string | null;   // ISO-8601
  };
}

export interface PolicyCallRecord {
  kind: 'policy_call';
  data: {
    id: string;
    stepId: string;            // UUID of the parent step
    provider: string;
    model: string;
    selectedTool: string;
    toolArguments: Record<string, unknown>;
    availableTools: Record<string, unknown>[];
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    createdAt: string;
  };
}

export type WebhookEventType =
  | 'node_started' | 'node_finished' | 'node_failed' | 'flow_terminated'
  | 'github_pr_opened' | 'github_pr_closed'
  | 'lifecycle_item_transitioned' | 'executor_dispatch_result';

export interface WebhookEventRecord {
  kind: 'webhook_event';
  data: {
    id: string;
    eventType: WebhookEventType;
    engineRunId: string;
    payload: Record<string, unknown>;
    signatureOk: boolean;
    source: 'engine' | 'github';
    receivedAt: string;
    processedAt: string | null;
  };
}

export interface OperatorSignalRecord {
  kind: 'operator_signal';
  data: {
    id: string;
    runId: string;             // Only kind that carries runId on the record
    name: string;              // e.g. 'implementation-complete'
    taskId: string | null;
    payload: Record<string, unknown>;
    receivedAt: string;
    dedupeKey: string;
  };
}
```

The UI groups `step` records by `data.stepNumber` (descending). Non-step kinds bypass the step grouping and render in a "Run events" panel below the timeline. Awaiting-human detection is currently a minimal heuristic (any `step` with `status='dispatched'`); a richer cue is BUG-002 PR B.

### `Signal`

The single write payload. Sent via `POST /api/v1/runs/{runId}/signals`.

```ts
export type SignalName = 'implementation-complete';

export interface SignalPayload {
  commitSha: string;
  prUrl: string;
  diff?: string;                   // Optional but used by the reviewer LLM
  implementationNotes?: string;    // Free-form
}

export interface SignalRequest {
  name: SignalName;
  taskId: string;                  // External ref like 'T-001', NOT the UUID
  payload: SignalPayload;
}

export interface SignalReceipt {
  id: string;
  name: SignalName;
  taskId: string;
  payload: SignalPayload;
  receivedAt: string;
}
```

`(runId, name, taskId)` is the idempotency key. Re-sends return `202` with `meta.alreadyReceived = true`.

### `Agent`

From `GET /api/v1/agents`. Used to populate the start-run form.

```ts
export interface AgentNode {
  name: string;
  kind: 'engine' | 'local' | 'remote' | 'human';
}

export interface Agent {
  ref: string;                     // e.g. 'lifecycle-agent@0.3.0'
  description?: string;
  nodes: AgentNode[];
}
```

### `ProblemDetails` (errors)

RFC 7807 envelope returned with `Content-Type: application/problem+json`.

```ts
export interface ProblemDetails {
  type: string;                    // URI identifier
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;                    // Stable programmatic discriminator
  errors?: Record<string, string[]>; // Optional field-level validation
}
```

The UI keys on `code` (not `status` alone) for error-specific copy.

### `Pagination` (`meta` block)

```ts
export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}
```

Returned in `meta` for collection endpoints (`/runs`, `/agents`).

### `OperatorSession`

UI-only. Held by the BFF, surfaced via `GET /auth/me`.

```ts
export interface OperatorSession {
  authenticated: boolean;
  expiresAt?: string;
}
```

---

## Relationships

```
Agent ──referenced-by──▶ RunSummary.agentRef
RunSummary ◀──extended-by── RunDetail
RunDetail ──streams──▶ TraceRecord[]  (via /trace endpoint)
RunDetail ──awaits──▶ Signal          (via /signals endpoint, idempotent on (runId, name, taskId))
```

A `Signal` is logically a child of `RunDetail`, but the orchestrator does not expose a list-signals endpoint. The receipt returned from `POST` is the only artifact.

There are no `WorkItem` or `Task` entities exposed in v1. `RunIntake.featureBriefPath` and the `taskId` field on awaiting human dispatches are the closest available references; the UI does not try to fabricate richer entities from them.

---

## Module Ownership

| Folder | Entities |
|--------|----------|
| `src/app/models/run.model.ts` | `RunStatus`, `TerminationReason`, `RunIntake`, `RunSummary`, `RunBudget`, `RunDetail` |
| `src/app/models/trace.model.ts` | `TraceRecord` and all variants |
| `src/app/models/signal.model.ts` | `SignalName`, `SignalPayload`, `SignalRequest`, `SignalReceipt` |
| `src/app/models/agent.model.ts` | `Agent`, `AgentNode` |
| `src/app/models/api.model.ts` | `Pagination`, `ProblemDetails` |
| `src/app/models/auth.model.ts` | `OperatorSession` |

---

## Conventions

- **camelCase fields** end-to-end. No transformation layer.
- **`unknown`, not `any`** for fields the UI does not render structurally (e.g., `intake`, `result`, `payload` of unknown agents).
- **Discriminated unions** for polymorphic shapes (`TraceRecord`).
- **Branded types** are not used in v1; plain `string` for IDs.

## Changelog

| Date | Change |
|------|--------|
| 2026-05-09 | Initial data model derived from `orchestrator-ui-starter.md` §3 endpoints and signal schema. |
| 2026-05-09 | FEAT-001 audit — added optional `ProblemDetails.errors: Record<string, string[]>` for 422 `invalid-signal-payload` per-field messages (RFC 7807 extension member). Module-ownership table now reflects flat `src/app/models/<name>.ts` layout (no `.model.ts` suffix). |
| 2026-05-10 | FEAT-003 — endpoint paths in entity descriptions reframed from `/api/v1/*` to `/v1/*` (no shape change). The SPA now calls the orchestrator directly; see `docs/api-spec.md` for the new auth and CORS framing. |
| 2026-05-11 | BUG-001 — endpoint paths reverted to `/api/v1/*` after discovering the orchestrator never exposed bare `/v1/*`. See `docs/api-spec.md` BUG-001 changelog row. No shape change. |
| 2026-05-11 | BUG-002 — `TraceRecord` rewritten to match the real orchestrator wire: enveloped `{ kind, data: { … } }` shape with four kinds (`step`, `policy_call`, `webhook_event`, `operator_signal`). Drop `executor_call`/`effector_call` (they exist upstream but in separate JSONL streams, not in `/api/v1/runs/:id/trace`). Per-kind timestamp fields replace the unified `occurredAt`; `step.status` enum widened (`pending`/`dispatched`/`in_progress`/`completed`/`failed`). Source: orchestrator `service.py:_serialize_trace_record` + `schemas.py` Pydantic models. |
| 2026-05-12 | BUG-002 PR B — No wire-shape changes; documents how the SPA renders the envelope. Each kind now exposes its structured fields via `app-trace-record-card` (see `docs/ui-specification.md` § Run Detail). Awaiting-human heuristic upgraded from "any `step` in `dispatched`" to "`step.data.nodeName` in the human-pause allowlist (`request_implementation`) AND `data.status` ∈ {`dispatched`, `in_progress`}", with a matching `webhook_event` (`eventType='node_started'`) surfaced above the signal form when present. |
| 2026-05-12 | BUG-002 PR D — Awaiting-human heuristic widened to also accept `status='pending'` (the real orchestrator never auto-dispatches human-pause nodes; they sit in `pending` until the operator submits). No wire-shape change. |
