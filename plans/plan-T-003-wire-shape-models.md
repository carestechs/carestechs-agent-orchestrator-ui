# Implementation Plan: T-003 — Define wire-shape models in `src/app/models/`

## Task Reference
- **Task ID:** T-003
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** S
- **Rationale:** Every service and component beyond this task consumes these types; defining them up front prevents `any` from leaking past the service boundary (`CLAUDE.md > Patterns to Follow > Boundary types`).

## Overview
Create one TypeScript file per logical model group under `src/app/models/`, mirroring the camelCase shapes documented in `docs/data-model.md` and `docs/api-spec.md`. Includes the `{ data, meta }` envelope generic, the discriminated `TraceRecord` union, signal/run/agent/session entities, and `ProblemDetails`. All exports are named — no default exports — per `CLAUDE.md > Code Style & Conventions > TypeScript & Angular > Named exports only`.

## Implementation Steps

### Step 1: Create the run domain types
**File:** `src/app/models/run.ts`
**Action:** Create
Define and export (named):
- `RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'`.
- `TerminationReason = 'done_node' | 'policy_terminated' | 'budget_exceeded' | 'correction_budget_exceeded' | 'error' | 'cancelled'`.
- `RunIntake` interface with optional `featureBriefPath?: string` and an index signature `[key: string]: unknown` (per `CLAUDE.md > Code Style & Conventions > TypeScript & Angular > No 'any'. Prefer 'unknown'`).
- `RunBudget { maxSteps: number; maxTokens?: number }`.
- `RunSummary` interface (id, agentRef, status, intake, startedAt, endedAt|null, lastStepNumber|null, terminationReason|null) — matching `docs/data-model.md`.
- `RunDetail extends RunSummary` adds `traceUri: string`, `budget: RunBudget`, `currentNode: string | null`.

### Step 2: Create the trace discriminated union
**File:** `src/app/models/trace.ts`
**Action:** Create
- `TraceRecordBase { recordId: string; runId: string; stepNumber: number; occurredAt: string }`.
- Variant interfaces extending the base, each with `kind` literal as the discriminator: `StepRecord` (`kind: 'step'`), `ExecutorCallRecord` (`kind: 'executor_call'` with `state: 'dispatched' | 'received' | 'completed' | 'failed'`, `mode: 'human' | 'local' | 'remote'`, `taskId?: string`, `intake?: unknown`, `outcome?: unknown`), `PolicyCallRecord` (`kind: 'policy_call'`), `WebhookEventRecord` (`kind: 'webhook_event'`), `EffectorCallRecord` (`kind: 'effector_call'`).
- Field shapes for non-executor variants follow `docs/data-model.md`; treat unknown sub-payloads as `unknown` and let later tasks narrow.
- Export the union: `export type TraceRecord = StepRecord | ExecutorCallRecord | PolicyCallRecord | WebhookEventRecord | EffectorCallRecord;` — required by AC-2.

### Step 3: Create signal request/receipt types
**File:** `src/app/models/signal.ts`
**Action:** Create
Per `docs/api-spec.md > POST /api/v1/runs/{runId}/signals`:
- `SignalName = 'implementation-complete'` (open union: `string` widening allowed for forward compat — keep narrow for v1).
- `SignalPayload { commitSha?: string; prUrl?: string; diff?: string; implementationNotes?: string }`.
- `SignalRequest { name: SignalName; taskId: string; payload: SignalPayload }`.
- `SignalReceipt { id: string; name: SignalName; taskId: string; payload: SignalPayload; receivedAt: string }`.

### Step 4: Create agent type
**File:** `src/app/models/agent.ts`
**Action:** Create
Per `docs/api-spec.md > GET /api/v1/agents`:
- `AgentNodeKind = 'local' | 'human' | 'remote'`.
- `AgentNode { name: string; kind: AgentNodeKind }`.
- `Agent { ref: string; description: string; nodes: AgentNode[] }`.

### Step 5: Create envelope generics
**File:** `src/app/models/envelope.ts`
**Action:** Create
Per `docs/api-spec.md > Conventions > Envelope`:
- `Pagination { page: number; pageSize: number; total: number }`.
- `Envelope<T> { data: T; meta: null | { alreadyReceived?: boolean } }`.
- `PaginatedEnvelope<T> { data: T[]; meta: Pagination }`.
Required by AC-3 (generics match `{ data, meta }` shape).

### Step 6: Create the problem-details type
**File:** `src/app/models/problem-details.ts`
**Action:** Create
Per `CLAUDE.md > Error Handling > RFC 7807 problem-details` and the error catalog in `docs/api-spec.md`:
- `ProblemDetails { type?: string; title: string; status: number; detail?: string; instance?: string; code: string }`.
- A union of known `code` literal strings (e.g., `'invalid-passphrase' | 'unauthenticated' | 'run-already-terminal' | 'task-not-in-run-memory' | 'invalid-signal-payload' | 'run-not-found' | 'agent-not-found' | 'invalid-intake' | 'forbidden' | 'upstream-unavailable' | 'upstream-error'`) widened with `string` to tolerate future codes: `export type ProblemCode = KnownProblemCode | (string & {});`.

### Step 7: Create the operator session type
**File:** `src/app/models/session.ts`
**Action:** Create
Per `docs/api-spec.md > GET /auth/me`:
- `OperatorSession { authenticated: true; expiresAt: string } | { authenticated: false }` — discriminated on `authenticated` to keep `expiresAt` typed.

### Step 8: Create the barrel re-export
**File:** `src/app/models/index.ts`
**Action:** Create
Re-export all named exports from each model file:
```ts
export * from './run.js';
export * from './trace.js';
export * from './signal.js';
export * from './agent.js';
export * from './envelope.js';
export * from './problem-details.js';
export * from './session.js';
```
No default exports anywhere (per `CLAUDE.md > Code Style & Conventions > TypeScript & Angular > Named exports only`).

### Step 9: Verify strict-mode compilation
**File:** (none — verification step)
**Action:** Modify
Run `npx tsc --noEmit` (or `npm run build` if SPA build does it). Required by AC-4 (no `any`). Confirm none of the model files contain `any`; only `unknown` for opaque payloads.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `src/app/models/run.ts` | Create | `RunStatus`, `TerminationReason`, `RunIntake`, `RunBudget`, `RunSummary`, `RunDetail`. |
| `src/app/models/trace.ts` | Create | `TraceRecord` discriminated union and per-`kind` variants. |
| `src/app/models/signal.ts` | Create | `SignalRequest`, `SignalPayload`, `SignalReceipt`, `SignalName`. |
| `src/app/models/agent.ts` | Create | `Agent`, `AgentNode`, `AgentNodeKind`. |
| `src/app/models/envelope.ts` | Create | `Envelope<T>`, `PaginatedEnvelope<T>`, `Pagination`. |
| `src/app/models/problem-details.ts` | Create | `ProblemDetails`, `ProblemCode`. |
| `src/app/models/session.ts` | Create | `OperatorSession` discriminated on `authenticated`. |
| `src/app/models/index.ts` | Create | Barrel re-export of all model files. |

## Edge Cases & Risks
- **Discriminated union narrowing in templates:** Angular's strict templates narrow on `kind` only inside `@if` / `@switch` blocks — components must use those, not `*ngIf` with type-cast pipes. Document this in T-018's plan, but the type itself enables it.
- **`code` field strictness vs forward compat:** widening with `(string & {})` preserves autocomplete on known codes while accepting unknowns; if too permissive, drop the widening and add new codes deliberately.
- **Diverging from orchestrator data model:** when `carestechs-agent-orchestrator/docs/data-model.md` adds fields, this UI's interfaces must be re-derived (per `CLAUDE.md > External Reference Repos`). T-023 enforces the changelog rule.
- **`unknown` in `RunIntake` index signature:** consumers must narrow before reading; preferable to `any` per `CLAUDE.md > Code Style & Conventions > TypeScript & Angular > No 'any'. Prefer 'unknown' plus a narrowing type guard at the boundary`.

## Acceptance Verification
- [ ] **AC-1** (One file per logical model group): Verify `ls src/app/models/` lists exactly `run.ts`, `trace.ts`, `signal.ts`, `agent.ts`, `envelope.ts`, `problem-details.ts`, `session.ts`, `index.ts`.
- [ ] **AC-2** (`TraceRecord` is a discriminated union on `kind`): Open `trace.ts`; the exported `TraceRecord` is `StepRecord | ExecutorCallRecord | PolicyCallRecord | WebhookEventRecord | EffectorCallRecord`, each variant has a literal `kind` field. A `switch (record.kind)` test in a scratch file narrows correctly.
- [ ] **AC-3** (`Envelope<T>` and `PaginatedEnvelope<T>` match `{ data, meta }`): Inspect `envelope.ts`; both generics expose `.data` and `.meta`; `PaginatedEnvelope<T>['meta']` is `Pagination`.
- [ ] **AC-4** (Strict mode compiles with no `any`): `npx tsc --noEmit` exits 0; `grep -rn '\bany\b' src/app/models/` returns nothing (excluding comments).
