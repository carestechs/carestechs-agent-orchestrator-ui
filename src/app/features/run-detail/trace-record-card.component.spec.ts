// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TraceRecordCardComponent } from './trace-record-card.component';
import type {
  OperatorSignalRecord,
  PolicyCallRecord,
  StepRecord,
  TraceRecord,
  WebhookEventRecord,
} from '../../models';

function setup(record: TraceRecord) {
  TestBed.configureTestingModule({ imports: [TraceRecordCardComponent] });
  const fixture = TestBed.createComponent(TraceRecordCardComponent);
  fixture.componentRef.setInput('record', record);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, component: fixture.componentInstance, el };
}

beforeEach(() => TestBed.resetTestingModule());

describe('TraceRecordCardComponent', () => {
  describe('step', () => {
    const baseStep: StepRecord = {
      kind: 'step',
      data: {
        id: 's1',
        stepNumber: 1,
        nodeName: 'request_implementation',
        status: 'completed',
        nodeInputs: { taskId: 'T-1', briefPath: 'docs/x.md' },
        nodeResult: { ok: true },
        error: null,
        dispatchedAt: '2026-05-09T09:00:00Z',
        completedAt: '2026-05-09T09:00:02Z',
      },
    };

    it('renders nodeName, status pill, and dispatchedAt', () => {
      const { el } = setup(baseStep);
      expect(el.innerHTML).toContain('request_implementation');
      expect(el.innerHTML).toContain('completed');
      expect(el.innerHTML).toContain('2026-05-09T09:00:00Z');
      expect(el.querySelector('[data-trace-kind="step"]')).not.toBeNull();
    });

    it('computes duration when both timestamps present', () => {
      const { component } = setup(baseStep);
      expect(component.stepDurationMs()).toBe(2000);
    });

    it('returns null duration when one timestamp is missing', () => {
      const r: StepRecord = { ...baseStep, data: { ...baseStep.data, completedAt: null } };
      const { component } = setup(r);
      expect(component.stepDurationMs()).toBeNull();
    });

    it('inputs/result are collapsed by default and toggled by the button', () => {
      const { el, fixture } = setup(baseStep);
      expect(el.innerHTML).not.toContain('briefPath');
      const btn = el.querySelector('[data-testid="trace-record-toggle"]') as HTMLButtonElement;
      btn.click();
      fixture.detectChanges();
      expect(el.innerHTML).toContain('briefPath');
      expect(el.innerHTML).toContain('"ok": true');
    });

    it('renders an error block when error is non-null', () => {
      const r: StepRecord = {
        ...baseStep,
        data: { ...baseStep.data, status: 'failed', error: { reason: 'boom' } },
      };
      const { el } = setup(r);
      expect(el.innerHTML.toLowerCase()).toContain('error');
      expect(el.innerHTML).toContain('boom');
    });
  });

  describe('policy_call', () => {
    const rec: PolicyCallRecord = {
      kind: 'policy_call',
      data: {
        id: 'p1',
        stepId: 's1',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        selectedTool: 'pick_node',
        toolArguments: { nodeName: 'request_implementation' },
        availableTools: [{ name: 'pick_node' }, { name: 'finish' }],
        inputTokens: 412,
        outputTokens: 88,
        latencyMs: 743,
        createdAt: '2026-05-09T09:00:01Z',
      },
    };

    it('renders provider/model, selected tool, tokens, and latency', () => {
      const { el } = setup(rec);
      expect(el.innerHTML).toContain('anthropic');
      expect(el.innerHTML).toContain('claude-sonnet-4-6');
      expect(el.innerHTML).toContain('pick_node');
      expect(el.innerHTML).toContain('412 in / 88 out');
      expect(el.innerHTML).toContain('743ms');
    });

    it('reveals toolArguments and availableTools on toggle', () => {
      const { el, fixture } = setup(rec);
      expect(el.innerHTML).not.toContain('"nodeName"');
      (el.querySelector('[data-testid="trace-record-toggle"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.innerHTML).toContain('"nodeName"');
      expect(el.innerHTML).toContain('Available tools (2)');
    });
  });

  describe('webhook_event', () => {
    const rec: WebhookEventRecord = {
      kind: 'webhook_event',
      data: {
        id: 'w1',
        eventType: 'node_started',
        engineRunId: 'engine-1',
        payload: { nodeName: 'request_implementation', extras: { run: 'x' } },
        signatureOk: true,
        source: 'engine',
        receivedAt: '2026-05-09T09:00:03Z',
        processedAt: '2026-05-09T09:00:03Z',
      },
    };

    it('renders eventType, source, and timestamp', () => {
      const { el } = setup(rec);
      expect(el.innerHTML).toContain('node_started');
      expect(el.innerHTML).toContain('engine');
      expect(el.innerHTML).toContain('2026-05-09T09:00:03Z');
    });

    it('flags unverified signatures', () => {
      const r: WebhookEventRecord = { ...rec, data: { ...rec.data, signatureOk: false } };
      const { el } = setup(r);
      expect(el.innerHTML.toLowerCase()).toContain('unverified');
    });

    it('expands the payload on toggle', () => {
      const { el, fixture } = setup(rec);
      expect(el.innerHTML).not.toContain('"extras"');
      (el.querySelector('[data-testid="trace-record-toggle"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.innerHTML).toContain('"extras"');
    });
  });

  describe('operator_signal', () => {
    const rec: OperatorSignalRecord = {
      kind: 'operator_signal',
      data: {
        id: 'sig1',
        runId: 'r1',
        name: 'implementation-complete',
        taskId: 'T-1',
        payload: { commitSha: 'abc1234' },
        receivedAt: '2026-05-09T09:01:00Z',
        dedupeKey: 'implementation-complete|T-1',
      },
    };

    it('renders name, taskId, dedupeKey, and timestamp', () => {
      const { el } = setup(rec);
      expect(el.innerHTML).toContain('implementation-complete');
      expect(el.innerHTML).toContain('T-1');
      expect(el.innerHTML).toContain('implementation-complete|T-1');
      expect(el.innerHTML).toContain('2026-05-09T09:01:00Z');
    });

    it('expands the payload on toggle', () => {
      const { el, fixture } = setup(rec);
      expect(el.innerHTML).not.toContain('commitSha');
      (el.querySelector('[data-testid="trace-record-toggle"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.innerHTML).toContain('commitSha');
    });
  });
});
