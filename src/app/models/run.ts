export type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

// The orchestrator's enum is open-ended in practice (any failure shape can
// land here); keep the well-known values typed and accept `string` for
// forward-compat. Source: orchestrator `service.py:_serialize_run_summary`.
export type StopReason =
  | 'done_node'
  | 'policy_terminated'
  | 'budget_exceeded'
  | 'correction_budget_exceeded'
  | 'error'
  | 'cancelled'
  | (string & {});

export interface RunIntake {
  featureBriefPath?: string;
  workItemPath?: string;
  [key: string]: unknown;
}

export interface RunBudget {
  maxSteps: number;
  maxTokens?: number;
}

// List endpoint returns a lean summary: id/agentRef/status/startedAt/endedAt
// always present; stopReason set on terminal runs; intake and lastStepNumber
// are NOT in the list wire (use RunDetail to get them). Source: live capture
// of GET /api/v1/runs against lifecycle-agent@0.3.0.
export interface RunSummary {
  id: string;
  agentRef: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  stopReason?: StopReason | null;
  intake?: RunIntake;
  lastStepNumber?: number | null;
}

export interface RunDetail extends RunSummary {
  // Detail endpoint includes the full intake, current node, budget, and trace
  // URI. `intake` is required here even though it's optional on the summary.
  intake: RunIntake;
  traceUri: string;
  budget: RunBudget;
  currentNode: string | null;
}
