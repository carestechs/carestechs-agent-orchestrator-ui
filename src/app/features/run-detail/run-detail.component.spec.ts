// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { defer, of, throwError } from 'rxjs';
import { RunDetailComponent } from './run-detail.component';
import { RunsService } from '../../core/runs.service';
import { TraceStreamService } from '../../core/trace-stream.service';
import { ToastService } from '../../shared/toast.service';
import { ConfirmModalService } from '../../shared/confirm-modal.service';
import { SignalsService } from '../../core/signals.service';
import { ProblemDetailsError } from '../../core/problem-details.error';
import type { RunDetail, TraceRecord } from '../../models';

const sampleDetail = (status: RunDetail['status'] = 'paused'): RunDetail => ({
  id: 'run-1',
  agentRef: 'demo-agent',
  status,
  intake: { featureBriefPath: 'docs/feat.md' },
  startedAt: '2026-05-09T09:00:00Z',
  endedAt: null,
  lastStepNumber: 2,
  terminationReason: null,
  traceUri: '/api/v1/runs/run-1/trace',
  budget: { maxSteps: 100 },
  currentNode: 'plan',
});

interface SetupOpts {
  status?: RunDetail['status'];
  getImpl?: () => unknown;
  cancelImpl?: () => unknown;
  confirmAnswer?: boolean;
  records?: TraceRecord[];
  streamStatus?: 'idle' | 'connecting' | 'streaming' | 'closed' | 'error';
}

function setup(opts: SetupOpts = {}) {
  const records = signal<TraceRecord[]>(opts.records ?? []);
  const streamStatus = signal(opts.streamStatus ?? 'streaming');
  const openSpy = vi.fn();
  const closeSpy = vi.fn();
  const traceStream = {
    records: records.asReadonly(),
    status: streamStatus.asReadonly(),
    open: openSpy,
    close: closeSpy,
  };

  const getImpl = opts.getImpl ?? (() => of(sampleDetail(opts.status)));
  const getSpy = vi.fn(getImpl);
  const cancelSpy = vi.fn(opts.cancelImpl ?? (() => of({ ...sampleDetail('cancelled') })));

  const confirmSpy = vi.fn().mockResolvedValue(opts.confirmAnswer ?? true);

  const toastInfo = vi.fn();
  const toastError = vi.fn();
  const toastSuccess = vi.fn();

  TestBed.configureTestingModule({
    imports: [RunDetailComponent],
    providers: [
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({ id: 'run-1' })),
          snapshot: { paramMap: convertToParamMap({ id: 'run-1' }) },
        },
      },
      { provide: RunsService, useValue: { get: getSpy, cancel: cancelSpy } },
      { provide: SignalsService, useValue: { submit: vi.fn(() => of({ data: {}, alreadyReceived: false })) } },
      {
        provide: Router,
        useValue: {
          createUrlTree: vi.fn(() => ({ toString: () => '/runs' })),
          serializeUrl: vi.fn(() => '/runs'),
          events: of(),
          routerState: { root: {} },
        },
      },
      { provide: TraceStreamService, useValue: traceStream },
      { provide: ToastService, useValue: { info: toastInfo, error: toastError, success: toastSuccess } },
      { provide: ConfirmModalService, useValue: { open: confirmSpy, state: signal(null).asReadonly() } },
    ],
  });

  const fixture = TestBed.createComponent(RunDetailComponent);
  return {
    fixture,
    component: fixture.componentInstance,
    getSpy,
    cancelSpy,
    openSpy,
    closeSpy,
    confirmSpy,
    toastInfo,
    toastError,
    streamStatus,
    records,
  };
}

beforeEach(() => {
  TestBed.resetTestingModule();
});

describe('RunDetailComponent', () => {
  it('opens the trace stream once on init', async () => {
    const { fixture, openSpy } = setup();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    expect(openSpy).toHaveBeenCalledWith('run-1');
  });

  it('renders the run header after fetch resolves', async () => {
    const { fixture, component } = setup();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(component.run()?.id).toBe('run-1');
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('demo-agent');
  });

  it('hides Cancel when run is terminal', async () => {
    const { fixture } = setup({ status: 'completed' });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain('Cancel run');
  });

  it('confirms before cancel and calls RunsService.cancel on confirm', async () => {
    const { fixture, component, cancelSpy, confirmSpy } = setup({ confirmAnswer: true });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    await component.onCancelClick();
    expect(confirmSpy).toHaveBeenCalled();
    expect(cancelSpy).toHaveBeenCalledWith('run-1');
  });

  it('does not cancel when the modal is dismissed', async () => {
    const { fixture, component, cancelSpy } = setup({ confirmAnswer: false });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    await component.onCancelClick();
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('on 409 run-already-terminal: toasts info and refreshes the run; no retry', async () => {
    const err = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Run already terminal',
      status: 409,
      code: 'run-already-terminal',
    });
    const { fixture, component, getSpy, cancelSpy, toastInfo } = setup({
      cancelImpl: () => defer(() => throwError(() => err)),
    });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    getSpy.mockClear();
    await component.onCancelClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(toastInfo).toHaveBeenCalledWith('This run is already terminal.');
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('aborts the trace stream on destroy', async () => {
    const { fixture, closeSpy } = setup();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    closeSpy.mockClear();
    fixture.destroy();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('shows the reconnect banner when stream status is error', async () => {
    const { fixture, streamStatus } = setup();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    streamStatus.set('error');
    fixture.detectChanges();
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html.toLowerCase()).toContain('reconnect');
  });
});
