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
  [key: string]: unknown;
}

export interface RunBudget {
  maxSteps: number;
  maxTokens?: number;
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

export interface RunDetail extends RunSummary {
  traceUri: string;
  budget: RunBudget;
  currentNode: string | null;
}
