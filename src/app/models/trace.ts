export interface TraceRecordBase {
  recordId: string;
  runId: string;
  stepNumber: number;
  occurredAt: string;
}

export interface StepRecord extends TraceRecordBase {
  kind: 'step';
  nodeName: string;
  state: 'started' | 'completed' | 'failed';
  detail?: unknown;
}

export type ExecutorCallState = 'dispatched' | 'received' | 'completed' | 'failed';
export type ExecutorCallMode = 'human' | 'local' | 'remote';

export interface ExecutorCallRecord extends TraceRecordBase {
  kind: 'executor_call';
  state: ExecutorCallState;
  mode: ExecutorCallMode;
  taskId?: string;
  intake?: unknown;
  outcome?: unknown;
}

export interface PolicyCallRecord extends TraceRecordBase {
  kind: 'policy_call';
  model?: string;
  prompt?: unknown;
  response?: unknown;
}

export interface WebhookEventRecord extends TraceRecordBase {
  kind: 'webhook_event';
  source?: string;
  payload?: unknown;
}

export interface EffectorCallRecord extends TraceRecordBase {
  kind: 'effector_call';
  effector?: string;
  args?: unknown;
  result?: unknown;
}

export type TraceRecord =
  | StepRecord
  | ExecutorCallRecord
  | PolicyCallRecord
  | WebhookEventRecord
  | EffectorCallRecord;

export type TraceRecordKind = TraceRecord['kind'];
