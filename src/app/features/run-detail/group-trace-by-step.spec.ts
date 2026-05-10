// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { groupTraceByStep } from './group-trace-by-step';
import type { TraceRecord } from '../../models';

const step = (id: string, n: number, t: string): TraceRecord => ({
  kind: 'step',
  recordId: id,
  runId: 'r',
  stepNumber: n,
  occurredAt: t,
  nodeName: 'load',
  state: 'started',
});

describe('groupTraceByStep', () => {
  it('returns [] for empty input', () => {
    expect(groupTraceByStep([])).toEqual([]);
  });

  it('groups by stepNumber and orders descending', () => {
    const recs: TraceRecord[] = [
      step('a', 1, 't1'),
      step('b', 2, 't2'),
      step('c', 1, 't3'),
      step('d', 3, 't4'),
    ];
    const out = groupTraceByStep(recs);
    expect(out.map((g) => g.stepNumber)).toEqual([3, 2, 1]);
  });

  it('preserves insertion order within a group', () => {
    const recs: TraceRecord[] = [
      step('a', 1, 't1'),
      step('b', 1, 't2'),
      step('c', 1, 't3'),
    ];
    const [g] = groupTraceByStep(recs);
    expect(g!.records.map((r) => r.recordId)).toEqual(['a', 'b', 'c']);
  });
});
