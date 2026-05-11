// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { groupTraceByStep } from './group-trace-by-step';
import type { StepRecord, TraceRecord, WebhookEventRecord } from '../../models';

const step = (id: string, n: number, t: string): StepRecord => ({
  kind: 'step',
  data: {
    id,
    stepNumber: n,
    nodeName: 'load_work_item',
    status: 'completed',
    nodeInputs: {},
    nodeResult: null,
    error: null,
    dispatchedAt: t,
    completedAt: t,
  },
});

const webhook = (id: string): WebhookEventRecord => ({
  kind: 'webhook_event',
  data: {
    id,
    eventType: 'node_started',
    engineRunId: 'engine-1',
    payload: {},
    signatureOk: true,
    source: 'engine',
    receivedAt: '2026-05-09T09:00:00Z',
    processedAt: null,
  },
});

describe('groupTraceByStep', () => {
  it('returns empty groups for empty input', () => {
    expect(groupTraceByStep([])).toEqual({ steps: [], other: [] });
  });

  it('groups step records by stepNumber and orders descending', () => {
    const recs: TraceRecord[] = [
      step('a', 1, 't1'),
      step('b', 2, 't2'),
      step('c', 1, 't3'),
      step('d', 3, 't4'),
    ];
    const { steps } = groupTraceByStep(recs);
    expect(steps.map((g) => g.stepNumber)).toEqual([3, 2, 1]);
  });

  it('preserves insertion order within a step group', () => {
    const recs: TraceRecord[] = [step('a', 1, 't1'), step('b', 1, 't2'), step('c', 1, 't3')];
    const { steps } = groupTraceByStep(recs);
    expect(steps[0]!.records.map((r) => r.data.id)).toEqual(['a', 'b', 'c']);
  });

  it('routes non-step records to `other` in insertion order', () => {
    const recs: TraceRecord[] = [
      step('a', 1, 't1'),
      webhook('w1'),
      step('b', 1, 't2'),
      webhook('w2'),
    ];
    const { steps, other } = groupTraceByStep(recs);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.records.map((r) => r.data.id)).toEqual(['a', 'b']);
    expect(other.map((r) => r.data.id)).toEqual(['w1', 'w2']);
  });
});
