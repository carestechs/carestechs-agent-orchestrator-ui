export type KnownProblemCode =
  | 'invalid-passphrase'
  | 'unauthenticated'
  | 'forbidden'
  | 'run-not-found'
  | 'agent-not-found'
  | 'task-not-in-run-memory'
  | 'run-already-terminal'
  | 'invalid-signal-payload'
  | 'invalid-intake'
  | 'upstream-unavailable'
  | 'upstream-error';

// eslint-disable-next-line @typescript-eslint/ban-types -- preserves autocomplete on KnownProblemCode while accepting future codes
export type ProblemCode = KnownProblemCode | (string & {});

export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: ProblemCode;
}
