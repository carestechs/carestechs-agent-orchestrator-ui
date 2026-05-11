// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { defer, of, throwError } from 'rxjs';
import { AwaitingSignalPanelComponent } from './awaiting-signal-panel.component';
import { SignalsService } from '../../core/signals.service';
import { ToastService } from '../../shared/toast.service';
import { ProblemDetailsError } from '../../core/problem-details.error';
import type { RunStatus, StepRecord, TraceRecord } from '../../models';

// BUG-002 PR A: cue is derived from `step` records in status='dispatched'.
// PR B will refine (allowlist of human-pause nodeNames, fall back to
// webhook_event for richer detail). Tests here cover the PR A heuristic.

const dispatchedStep = (taskId: string, dispatchedAt: string, id?: string): StepRecord => ({
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

  it('shows form with prefilled, read-only taskId for a single dispatch', () => {
    const { fixture, component } = setup({
      records: [dispatchedStep('T-001', '2026-05-09T09:00:01Z')],
      runStatus: 'paused',
    });
    expect(component.formVisible()).toBe(true);
    expect(component.taskIdMode()).toBe('single');
    expect(component.form.controls.taskId.value).toBe('T-001');
    expect(component.form.controls.taskId.disabled).toBe(true);
    const input = (fixture.nativeElement as HTMLElement).querySelector('#task-id') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.readOnly).toBe(true);
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
