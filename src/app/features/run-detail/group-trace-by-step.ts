import type { TraceRecord } from '../../models';

export interface StepGroup {
  stepNumber: number;
  records: TraceRecord[];
}

export function groupTraceByStep(records: TraceRecord[]): StepGroup[] {
  const buckets = new Map<number, TraceRecord[]>();
  for (const r of records) {
    const list = buckets.get(r.stepNumber);
    if (list) list.push(r);
    else buckets.set(r.stepNumber, [r]);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([stepNumber, recs]) => ({ stepNumber, records: recs }));
}
