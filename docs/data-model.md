# Data Model

## Overview

The UI is a stateless consumer — it does not own any persistent entities. This document defines the **TypeScript view models** the SPA uses to render orchestrator data. Wire shapes are camelCase JSON over HTTP from the orchestrator (passed through unchanged by the BFF).

When this document and `carestechs-agent-orchestrator/docs/data-model.md` diverge, the orchestrator's is authoritative. Update this file and add a changelog entry.

All interfaces live in `src/app/models/`.

---

## Entities

### `RunSummary`

A row in the runs list. From `GET /v1/runs`.

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

From `GET /v1/runs/{runId}`. Superset of `RunSummary`.

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

One JSON object per line of the NDJSON trace stream. Discriminated on `kind`.

```ts
export type TraceRecord =
  | StepRecord
  | ExecutorCallRecord
  | PolicyCallRecord
  | WebhookEventRecord
  | EffectorCallRecord;

export interface TraceRecordBase {
  recordId: string;
  runId: string;
  stepNumber: number;
  occurredAt: string; // ISO-8601
}

export interface StepRecord extends TraceRecordBase {
  kind: 'step';
  nodeName: string;
  state: 'started' | 'completed' | 'failed';
}

export interface ExecutorCallRecord extends TraceRecordBase {
  kind: 'executor_call';
  nodeName: string;
  mode: 'local' | 'remote' | 'human' | 'engine';
  state: 'dispatched' | 'completed' | 'failed';
  intake: Record<string, unknown>;     // What was sent to the executor
  result: Record<string, unknown> | null; // What came back; null while still dispatched
}

export interface PolicyCallRecord extends TraceRecordBase {
  kind: 'policy_call';
  provider: string;
  model: string;
  toolSelected: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface WebhookEventRecord extends TraceRecordBase {
  kind: 'webhook_event';
  source: string;
  payload: Record<string, unknown>;
}

export interface EffectorCallRecord extends TraceRecordBase {
  kind: 'effector_call';
  effector: string;
  result: Record<string, unknown>;
}
```

The UI keys most of its rendering on `executor_call` records:

- `state=dispatched` + `mode=human` → the awaiting human pause. The signal form prefills from this record's `intake`.
- `state=completed` → render result (truncated) inside the timeline.
- `state=failed` → render in error styling.

### `Signal`

The single write payload. Sent via `POST /v1/runs/{runId}/signals`.

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

From `GET /v1/agents`. Used to populate the start-run form.

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
