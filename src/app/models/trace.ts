// Wire shapes for `GET /api/v1/runs/{runId}/trace` (NDJSON, one record per line).
// The orchestrator wraps every record in `{ kind, data: { ... } }`. Each kind has
// kind-specific fields including its own timestamp(s); there is no unified
// `occurredAt`. See `src/app/core/trace-helpers.ts` for the discriminator-aware
// accessors and `docs/data-model.md` § Trace records for the upstream source.
//
// `executor_call` and `effector_call` exist upstream but in *separate* JSONL
// streams (`<trace_dir>/executors/…`, `<trace_dir>/effectors/…`), not in the
// run trace. They are intentionally absent here.

export type StepStatus = 'pending' | 'dispatched' | 'in_progress' | 'completed' | 'failed';

export interface StepRecord {
  kind: 'step';
  data: {
    id: string;
    stepNumber: number;
    nodeName: string;
    status: StepStatus;
    nodeInputs: Record<string, unknown>;
    nodeResult: Record<string, unknown> | null;
    error: Record<string, unknown> | null;
    dispatchedAt: string | null;
    completedAt: string | null;
  };
}

export interface PolicyCallRecord {
  kind: 'policy_call';
  data: {
    id: string;
    stepId: string;
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
  | 'node_started'
  | 'node_finished'
  | 'node_failed'
  | 'flow_terminated'
  | 'github_pr_opened'
  | 'github_pr_closed'
  | 'lifecycle_item_transitioned'
  | 'executor_dispatch_result';

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
    runId: string;
    name: string;
    taskId: string | null;
    payload: Record<string, unknown>;
    receivedAt: string;
    dedupeKey: string;
  };
}

export type TraceRecord =
  | StepRecord
  | PolicyCallRecord
  | WebhookEventRecord
  | OperatorSignalRecord;

export type TraceRecordKind = TraceRecord['kind'];
