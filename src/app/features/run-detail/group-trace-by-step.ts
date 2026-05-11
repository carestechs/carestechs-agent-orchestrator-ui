import type { StepRecord, TraceRecord } from '../../models';

export interface StepGroup {
  stepNumber: number;
  records: StepRecord[];
}

export interface GroupedTrace {
  steps: StepGroup[];
  // Non-step records (policy_call, webhook_event, operator_signal). These don't
  // carry a stepNumber on the wire and are rendered out-of-band by the timeline.
  other: TraceRecord[];
}

export function groupTraceByStep(records: TraceRecord[]): GroupedTrace {
  const buckets = new Map<number, StepRecord[]>();
  const other: TraceRecord[] = [];
  for (const r of records) {
    if (r.kind !== 'step') {
      other.push(r);
      continue;
    }
    const n = r.data.stepNumber;
    const list = buckets.get(n);
    if (list) list.push(r);
    else buckets.set(n, [r]);
  }
  const steps: StepGroup[] = [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([stepNumber, recs]) => ({ stepNumber, records: recs }));
  return { steps, other };
}
