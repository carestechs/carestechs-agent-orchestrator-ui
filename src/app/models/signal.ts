export type KnownSignalName = 'implementation-complete';
// eslint-disable-next-line @typescript-eslint/ban-types -- preserves autocomplete on KnownSignalName while accepting future names
export type SignalName = KnownSignalName | (string & {});

export interface SignalPayload {
  commitSha?: string;
  prUrl?: string;
  diff?: string;
  implementationNotes?: string;
  [key: string]: unknown;
}

export interface SignalRequest {
  name: SignalName;
  taskId: string;
  payload: SignalPayload;
}

export interface SignalReceipt {
  id: string;
  name: SignalName;
  taskId: string;
  payload: SignalPayload;
  receivedAt: string;
}
