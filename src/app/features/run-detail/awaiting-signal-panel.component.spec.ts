// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { defer, of, throwError } from 'rxjs';
import { AwaitingSignalPanelComponent } from './awaiting-signal-panel.component';
import { SignalsService } from '../../core/signals.service';
import { ToastService } from '../../shared/toast.service';
import { ProblemDetailsError } from '../../core/problem-details.error';
import type { RunStatus, StepRecord, TraceRecord, WebhookEventRecord } from '../../models';

// BUG-002 PR B: cue is derived from `step` records whose nodeName is in the
// human-pause allowlist (`request_implementation`) AND whose status is
// `dispatched` or `in_progress`. A matching webhook_event (`node_started`)
// is surfaced above the form.

const dispatchedStep = (
  taskId: string,
  dispatchedAt: string,
  id?: string,
  overrides: Partial<StepRecord['data']> = {},
): StepRecord => ({
  kind: 'step',
  data: {
    id: id ?? `s-${taskId}-${dispatchedAt}`,
    stepNumber: 1,
    nodeName: 'request_implementation',
    status: 'dispatched',
    nodeInputs: { taskId },
    nodeResult: null,
    error: null,
    dispatchedAt,
    completedAt: null,
    ...overrides,
  },
});

const webhookNodeStarted = (
  nodeName: string,
  receivedAt: string,
  id = `wh-${nodeName}-${receivedAt}`,
): WebhookEventRecord => ({
  kind: 'webhook_event',
  data: {
    id,
    eventType: 'node_started',
    engineRunId: 'engine-1',
    payload: { nodeName, taskId: 'T-001' },
    signatureOk: true,
    source: 'engine',
    receivedAt,
    processedAt: receivedAt,
  },
});

interface SetupOpts {
  records?: TraceRecord[];
  runStatus?: RunStatus;
  submitImpl?: () => unknown;
}

function setup(opts: SetupOpts = {}) {
  const submitSpy = vi.fn(opts.submitImpl ?? (() => of({
    data: {
      id: 'sig-1',
      name: 'implementation-complete',
      taskId: 'T-001',
      payload: {},
      receivedAt: '2026-05-09T09:00:00Z',
    },
    alreadyReceived: false,
  })));
  const toastSuccess = vi.fn();
  const toastInfo = vi.fn();
  const toastError = vi.fn();

  TestBed.configureTestingModule({
    imports: [AwaitingSignalPanelComponent],
    providers: [
      { provide: SignalsService, useValue: { submit: submitSpy } },
      {
        provide: ToastService,
        useValue: { success: toastSuccess, info: toastInfo, error: toastError },
      },
    ],
  });

  const fixture = TestBed.createComponent(AwaitingSignalPanelComponent);
  fixture.componentRef.setInput('runId', 'run-1');
  fixture.componentRef.setInput('traceRecords', opts.records ?? []);
  fixture.componentRef.setInput('runStatus', opts.runStatus ?? 'paused');
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, submitSpy, toastSuccess, toastInfo, toastError };
}

beforeEach(() => {
  TestBed.resetTestingModule();
});

describe('AwaitingSignalPanelComponent', () => {
  it('renders nothing when there are no dispatched step records', () => {
    const { fixture } = setup({ records: [], runStatus: 'running' });
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain('Awaiting signal');
  });

  it('shows form with prefilled taskId chip for a single dispatch', () => {
    const { fixture, component } = setup({
      records: [dispatchedStep('T-001', '2026-05-09T09:00:01Z')],
      runStatus: 'paused',
    });
    expect(component.formVisible()).toBe(true);
    expect(component.taskIdMode()).toBe('single');
    expect(component.form.controls.taskId.value).toBe('T-001');
    expect(component.form.controls.taskId.disabled).toBe(true);
    const chip = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="signal-task-id-chip"]',
    );
    expect(chip?.textContent?.trim()).toBe('T-001');
    const srInput = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="signal-task-id"]',
    ) as HTMLInputElement;
    expect(srInput.classList.contains('sr-only')).toBe(true);
    expect(srInput.value).toBe('T-001');
  });

  it('renders a picker when there are multiple distinct taskIds', () => {
    const { fixture, component } = setup({
      records: [
        dispatchedStep('T-001', '2026-05-09T09:00:01Z', 's1'),
        dispatchedStep('T-002', '2026-05-09T09:00:02Z', 's2'),
      ],
      runStatus: 'paused',
    });
    expect(component.taskIdMode()).toBe('picker');
    const select = (fixture.nativeElement as HTMLElement).querySelector('#task-id') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.querySelectorAll('option').length).toBe(2);
  });

  it('successful submit toasts "Signal received" and clears optional fields (taskId retained)', async () => {
    const { component, submitSpy, toastSuccess } = setup({
      records: [dispatchedStep('T-001', '2026-05-09T09:00:01Z')],
    });
    component.form.patchValue({
      commitSha: 'abcdef1',
      prUrl: 'https://github.com/o/r/pull/1',
      diff: 'diff content',
      implementationNotes: 'notes',
    });
    await component.onSubmit();
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Signal received');
    expect(component.form.controls.commitSha.value).toBe('');
    expect(component.form.controls.prUrl.value).toBe('');
    expect(component.form.controls.diff.value).toBe('');
    expect(component.form.controls.implementationNotes.value).toBe('');
    expect(component.form.controls.taskId.value).toBe('T-001');
  });

  it('shows "Signal already received" when meta.alreadyReceived is true', async () => {
    const { component, toastSuccess } = setup({
      records: [dispatchedStep('T-001', '2026-05-09T09:00:01Z')],
      submitImpl: () =>
        of({
          data: { id: 'sig-1', name: 'implementation-complete', taskId: 'T-001', payload: {}, receivedAt: 't' },
          alreadyReceived: true,
        }),
    });
    component.form.patchValue({ commitSha: 'abcdef1', prUrl: 'https://github.com/o/r/pull/1' });
    await component.onSubmit();
    expect(toastSuccess).toHaveBeenCalledWith('Signal already received');
  });

  it('on 404 task-not-in-run-memory sets inline taskIdError and does not toast', async () => {
    const err = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Task not in memory',
      status: 404,
      code: 'task-not-in-run-memory',
    });
    const { component, toastError } = setup({
      records: [dispatchedStep('T-001', '2026-05-09T09:00:01Z')],
      submitImpl: () => defer(() => throwError(() => err)),
    });
    component.form.patchValue({ commitSha: 'abcdef1', prUrl: 'https://github.com/o/r/pull/1' });
    await component.onSubmit();
    expect(component.taskIdError()).not.toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('on 422 invalid-signal-payload populates per-field errors', async () => {
    const err = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Invalid signal payload',
      status: 422,
      code: 'invalid-signal-payload',
      errors: { commitSha: ['must be hex'], prUrl: ['must be https'] },
    });
    const { component } = setup({
      records: [dispatchedStep('T-001', '2026-05-09T09:00:01Z')],
      submitImpl: () => defer(() => throwError(() => err)),
    });
    component.form.patchValue({ commitSha: 'abcdef1', prUrl: 'https://github.com/o/r/pull/1' });
    await component.onSubmit();
    const fe = component.fieldErrors();
    expect(fe['commitSha']).toEqual(['must be hex']);
    expect(fe['prUrl']).toEqual(['must be https']);
  });

  it('on 409 run-already-terminal toasts info and emits runRefreshRequested', async () => {
    const err = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Run already terminal',
      status: 409,
      code: 'run-already-terminal',
    });
    const { component, toastInfo, submitSpy } = setup({
      records: [dispatchedStep('T-001', '2026-05-09T09:00:01Z')],
      submitImpl: () => defer(() => throwError(() => err)),
    });
    const refreshSpy = vi.fn();
    component.runRefreshRequested.subscribe(refreshSpy);
    component.form.patchValue({ commitSha: 'abcdef1', prUrl: 'https://github.com/o/r/pull/1' });
    await component.onSubmit();
    expect(toastInfo).toHaveBeenCalledWith('This run is already terminal.');
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it('does not dedupe — two completed submits result in two network calls', async () => {
    const { component, submitSpy } = setup({
      records: [dispatchedStep('T-001', '2026-05-09T09:00:01Z')],
    });
    component.form.patchValue({ commitSha: 'abcdef1', prUrl: 'https://github.com/o/r/pull/1' });
    await component.onSubmit();
    component.form.patchValue({ commitSha: 'abcdef1', prUrl: 'https://github.com/o/r/pull/1' });
    await component.onSubmit();
    expect(submitSpy).toHaveBeenCalledTimes(2);
  });

  it('ignores dispatched steps whose nodeName is not in the human-pause allowlist', () => {
    const offAllowlist = dispatchedStep('T-999', '2026-05-09T09:00:01Z', 's-off', {
      nodeName: 'plan',
    });
    const { component } = setup({ records: [offAllowlist], runStatus: 'paused' });
    expect(component.formVisible()).toBe(false);
    expect(component.awaitingDispatches().length).toBe(0);
  });

  it('treats status="pending" the same as "dispatched" for allowlisted nodes (real wire)', () => {
    // Human-pause nodes never auto-dispatch on the real orchestrator; they
    // sit in 'pending' until the operator's signal acts as the dispatch.
    const pending = dispatchedStep('T-001', '2026-05-09T09:00:01Z', 's-pending', {
      status: 'pending',
      dispatchedAt: null,
    });
    const { component } = setup({ records: [pending], runStatus: 'paused' });
    expect(component.formVisible()).toBe(true);
    expect(component.form.controls.taskId.value).toBe('T-001');
  });

  it('treats status="in_progress" the same as "dispatched" for allowlisted nodes', () => {
    const inProgress = dispatchedStep('T-001', '2026-05-09T09:00:01Z', 's-ip', {
      status: 'in_progress',
    });
    const { component } = setup({ records: [inProgress], runStatus: 'paused' });
    expect(component.formVisible()).toBe(true);
    expect(component.form.controls.taskId.value).toBe('T-001');
  });

  it('surfaces a matching node_started webhook_event above the form', () => {
    const records: TraceRecord[] = [
      dispatchedStep('T-001', '2026-05-09T09:00:01Z'),
      webhookNodeStarted('request_implementation', '2026-05-09T09:00:02Z'),
    ];
    const { fixture, component } = setup({ records, runStatus: 'paused' });
    expect(component.dispatchWebhook()).not.toBeNull();
    const block = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="dispatch-webhook"]',
    );
    expect(block).not.toBeNull();
  });

  it('ignores webhook_events for non-matching nodeNames', () => {
    const records: TraceRecord[] = [
      dispatchedStep('T-001', '2026-05-09T09:00:01Z'),
      webhookNodeStarted('plan', '2026-05-09T09:00:02Z'),
    ];
    const { component } = setup({ records, runStatus: 'paused' });
    expect(component.dispatchWebhook()).toBeNull();
  });

  it('guards against double-submit while a request is in flight', () => {
    const inflight = vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => undefined }) }));
    const { component } = setup({
      records: [dispatchedStep('T-001', '2026-05-09T09:00:01Z')],
      submitImpl: inflight as unknown as () => unknown,
    });
    component.form.patchValue({ commitSha: 'abcdef1', prUrl: 'https://github.com/o/r/pull/1' });
    void component.onSubmit();
    void component.onSubmit();
    expect(inflight).toHaveBeenCalledTimes(1);
  });
});
