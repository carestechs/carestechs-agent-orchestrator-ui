import type { TraceRecord } from '../models';

export function getRecordId(r: TraceRecord): string {
  return r.data.id;
}

// Each kind has its own timestamp(s). Prefer the "finished/processed" time
// when available so the timeline orders records by when they actually
// concluded, falling back to the earliest known time.
export function getOccurredAt(r: TraceRecord): string {
  switch (r.kind) {
    case 'step':
      return r.data.completedAt ?? r.data.dispatchedAt ?? '';
    case 'policy_call':
      return r.data.createdAt;
    case 'webhook_event':
      return r.data.processedAt ?? r.data.receivedAt;
    case 'operator_signal':
      return r.data.receivedAt;
  }
}

export function getStepNumber(r: TraceRecord): number | null {
  return r.kind === 'step' ? r.data.stepNumber : null;
}
