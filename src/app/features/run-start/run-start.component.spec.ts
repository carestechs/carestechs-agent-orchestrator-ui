// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Location } from '@angular/common';
import { Subject, of, throwError } from 'rxjs';
import { RunStartComponent } from './run-start.component';
import { AgentsService } from '../../core/agents.service';
import { RunsService } from '../../core/runs.service';
import { ProblemDetailsError } from '../../core/problem-details.error';
import type { Agent, RunSummary } from '../../models';

const sampleAgents: Agent[] = [
  { ref: 'lifecycle-agent@0.3.0', description: 'Drives the lifecycle.', nodes: [] },
  { ref: 'spec-writer@0.1.2', description: 'Writes specs.', nodes: [] },
];

const sampleRunSummary: RunSummary = {
  id: 'run-new-1',
  agentRef: 'lifecycle-agent@0.3.0',
  status: 'running',
  intake: { featureBriefPath: 'docs/feat.md' },
  startedAt: '2026-05-10T10:00:00Z',
  endedAt: null,
  lastStepNumber: null,
  stopReason: null,
};

interface SetupOpts {
  listImpl?: () => unknown;
  startRunImpl?: (req: unknown) => unknown;
  historyLength?: number;
}

function setup(opts: SetupOpts = {}) {
  const listSpy = vi.fn(opts.listImpl ?? (() => of(sampleAgents)));
  const startRunSpy = vi.fn(opts.startRunImpl ?? (() => of(sampleRunSummary)));
  const backSpy = vi.fn();

  TestBed.configureTestingModule({
    imports: [RunStartComponent],
    providers: [
      provideRouter([]),
      { provide: AgentsService, useValue: { list: listSpy } },
      { provide: RunsService, useValue: { startRun: startRunSpy } },
      { provide: Location, useValue: { back: backSpy } },
    ],
  });

  if (opts.historyLength !== undefined) {
    Object.defineProperty(window.history, 'length', {
      configurable: true,
      get: () => opts.historyLength,
    });
  }

  const router = TestBed.inject(Router);
  const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

  const fixture = TestBed.createComponent(RunStartComponent);
  return { fixture, component: fixture.componentInstance, listSpy, startRunSpy, navSpy, backSpy };
}

async function fillValidForm(component: RunStartComponent, fixture: { detectChanges: () => void }) {
  // Structured mode is the default. Set the three workItem fields.
  component.form.controls.agentRef.setValue('lifecycle-agent@0.3.0');
  component.form.controls.workItemId.setValue('FEAT-100');
  component.form.controls.workItemKind.setValue('FEAT');
  component.form.controls.workItemContent.setValue('# FEAT-100\n\nbody');
  // Wait for the form's status pipeline to settle.
  await Promise.resolve();
  fixture.detectChanges();
}

async function fillValidJsonForm(component: RunStartComponent, fixture: { detectChanges: () => void }) {
  // Some legacy assertions expect the JSON-mode wire path. Flip to JSON mode
  // and write a valid JSON payload there.
  component.toggleIntakeMode();
  component.form.controls.agentRef.setValue('lifecycle-agent@0.3.0');
  component.form.controls.intakeJson.setValue('{ "workItem": { "id": "FEAT-100", "kind": "FEAT", "content": "# x" } }');
  await Promise.resolve();
  fixture.detectChanges();
}

beforeEach(() => {
  TestBed.resetTestingModule();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RunStartComponent', () => {
  it('renders the page-shell with a Cancel button', async () => {
    const { fixture } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="run-start"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="cancel-button"]')).not.toBeNull();
  });

  it('shows the agents-loading skeleton while AgentsService is in flight', () => {
    const subj = new Subject<Agent[]>();
    const { fixture } = setup({ listImpl: () => subj });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="agents-loading"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="run-start-form"]')).toBeNull();
    subj.next(sampleAgents);
    subj.complete();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="agents-loading"]')).toBeNull();
    expect(root.querySelector('[data-testid="run-start-form"]')).not.toBeNull();
  });

  it('renders the empty-state with a refresh button when zero agents are returned', async () => {
    const { fixture, listSpy } = setup({ listImpl: () => of([]) });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="agents-empty"]')).not.toBeNull();
    const refresh = root.querySelector('[data-testid="refresh-agents"]') as HTMLButtonElement;
    expect(refresh).not.toBeNull();
    listSpy.mockClear();
    refresh.click();
    fixture.detectChanges();
    expect(listSpy).toHaveBeenCalled();
  });

  it('renders the agent picker options after agents resolve', async () => {
    const { fixture } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="agent-picker"]',
    ) as HTMLSelectElement;
    const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent?.trim());
    expect(optionTexts).toContain('lifecycle-agent@0.3.0');
    expect(optionTexts).toContain('spec-writer@0.1.2');
  });

  it('keeps submit disabled until all structured fields are filled', async () => {
    const { fixture, component } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.submitDisabled()).toBe(true);

    component.form.controls.agentRef.setValue('lifecycle-agent@0.3.0');
    component.form.controls.workItemId.setValue('FEAT-100');
    component.form.controls.workItemKind.setValue('FEAT');
    component.form.controls.workItemContent.setValue('# brief');
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.submitDisabled()).toBe(false);
  });

  it('JSON mode: inline parse error appears after the 200ms debounce on malformed JSON', async () => {
    vi.useFakeTimers();
    const { fixture, component } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    component.toggleIntakeMode();
    fixture.detectChanges();
    component.form.controls.intakeJson.setValue('{not json');
    fixture.detectChanges();
    expect(component.intakeErrorMessage()).toBeNull();
    vi.advanceTimersByTime(250);
    fixture.detectChanges();
    expect(component.intakeErrorMessage()).not.toBeNull();
    expect(component.submitDisabled()).toBe(true);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="intake-error"]')).not.toBeNull();
  });

  it('JSON mode: Format button pretty-prints valid intake and is a no-op on invalid', async () => {
    const { fixture, component } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    component.toggleIntakeMode();
    fixture.detectChanges();
    component.form.controls.intakeJson.setValue('{"a":1,"b":{"c":2}}');
    component.onFormat();
    expect(component.form.controls.intakeJson.value).toBe(JSON.stringify({ a: 1, b: { c: 2 } }, null, 2));

    component.form.controls.intakeJson.setValue('{not json');
    const before = component.form.controls.intakeJson.value;
    component.onFormat();
    expect(component.form.controls.intakeJson.value).toBe(before);
  });

  it('maxSteps validator: blank → valid; 0 → invalid; 12 → valid; 1.5 → invalid', async () => {
    const { fixture, component } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    component.form.controls.maxSteps.setValue(null);
    expect(component.maxStepsErrorMessage()).toBeNull();

    component.form.controls.maxSteps.setValue(0);
    expect(component.maxStepsErrorMessage()).not.toBeNull();

    component.form.controls.maxSteps.setValue(12);
    expect(component.maxStepsErrorMessage()).toBeNull();

    component.form.controls.maxSteps.setValue(1.5);
    expect(component.maxStepsErrorMessage()).not.toBeNull();
  });

  it('Cancel calls Location.back when history.length > 1', async () => {
    const { fixture, component, navSpy, backSpy } = setup({ historyLength: 5 });
    fixture.detectChanges();
    await Promise.resolve();
    component.onCancel();
    expect(backSpy).toHaveBeenCalled();
    expect(navSpy).not.toHaveBeenCalled();
  });

  it('Cancel falls back to Router.navigate(["/runs"]) when history.length === 1', async () => {
    const { fixture, component, navSpy, backSpy } = setup({ historyLength: 1 });
    fixture.detectChanges();
    await Promise.resolve();
    component.onCancel();
    expect(navSpy).toHaveBeenCalledWith(['/runs']);
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('renders app-full-page-error when AgentsService rejects with ProblemDetailsError', async () => {
    const err = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Upstream unavailable',
      status: 502,
      code: 'upstream-unavailable',
    });
    const { fixture, component } = setup({ listImpl: () => throwError(() => err) });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.agentsError()).not.toBeNull();
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Upstream unavailable');
  });

  it('onSubmit posts a StartRunRequest and navigates to /runs/:id on 202', async () => {
    const subj = new Subject<RunSummary>();
    const { fixture, component, startRunSpy, navSpy } = setup({ startRunImpl: () => subj });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    await fillValidForm(component, fixture);

    component.onSubmit(new Event('submit'));
    expect(startRunSpy).toHaveBeenCalledTimes(1);
    expect(startRunSpy.mock.calls[0]![0]).toEqual({
      agentRef: 'lifecycle-agent@0.3.0',
      intake: { workItem: { id: 'FEAT-100', kind: 'FEAT', content: '# FEAT-100\n\nbody' } },
    });
    expect(component.submitting()).toBe(true);

    subj.next(sampleRunSummary);
    subj.complete();
    await Promise.resolve();
    expect(navSpy).toHaveBeenCalledWith(['/runs', 'run-new-1']);
  });

  it('includes budget.maxSteps in the request when provided; omits it when blank', async () => {
    const { fixture, component, startRunSpy } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    await fillValidForm(component, fixture);

    component.form.controls.maxSteps.setValue(150);
    await Promise.resolve();
    fixture.detectChanges();
    component.onSubmit(new Event('submit'));
    expect(startRunSpy.mock.calls[0]![0]).toEqual({
      agentRef: 'lifecycle-agent@0.3.0',
      intake: { workItem: { id: 'FEAT-100', kind: 'FEAT', content: '# FEAT-100\n\nbody' } },
      budget: { maxSteps: 150 },
    });

    startRunSpy.mockClear();
    component.form.controls.maxSteps.setValue(null);
    await Promise.resolve();
    fixture.detectChanges();
    // Reset submitting from the previous successful submit so submitDisabled allows another submit.
    component.submitting.set(false);
    component.onSubmit(new Event('submit'));
    const body = startRunSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect('budget' in body).toBe(false);
  });

  it('does not call startRun more than once for rapid double-clicks', async () => {
    const subj = new Subject<RunSummary>();
    const { fixture, component, startRunSpy } = setup({ startRunImpl: () => subj });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    await fillValidForm(component, fixture);
    component.onSubmit(new Event('submit'));
    component.onSubmit(new Event('submit'));
    component.onSubmit(new Event('submit'));
    expect(startRunSpy).toHaveBeenCalledTimes(1);
  });

  it('400 invalid-intake surfaces under the intake editor without losing the typed payload', async () => {
    const err = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Intake JSON failed validation',
      status: 400,
      code: 'invalid-intake',
      detail: 'Required field "branch" is missing.',
    });
    const { fixture, component } = setup({ startRunImpl: () => throwError(() => err) });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    await fillValidJsonForm(component, fixture);

    const typedIntake = component.form.controls.intakeJson.value;
    component.onSubmit(new Event('submit'));
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.submitError()?.scope).toBe('intake');
    expect(component.submitting()).toBe(false);
    expect(component.form.controls.intakeJson.value).toBe(typedIntake);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="intake-server-error"]')).not.toBeNull();
  });

  it('404 agent-not-found surfaces under the agent picker with a refresh affordance', async () => {
    const err = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Agent not found',
      status: 404,
      code: 'agent-not-found',
    });
    const { fixture, component, listSpy } = setup({ startRunImpl: () => throwError(() => err) });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    await fillValidForm(component, fixture);
    component.onSubmit(new Event('submit'));
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.submitError()?.scope).toBe('agent');
    const root = fixture.nativeElement as HTMLElement;
    const refresh = root.querySelector('[data-testid="refresh-agents-after-error"]') as HTMLButtonElement;
    expect(refresh).not.toBeNull();

    listSpy.mockClear();
    refresh.click();
    fixture.detectChanges();
    expect(listSpy).toHaveBeenCalled();
    expect(component.submitError()).toBeNull();
  });

  it('502 upstream-unavailable shows the page-level error and hides the form; retry re-submits', async () => {
    let calls = 0;
    const err = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Orchestrator unavailable',
      status: 502,
      code: 'upstream-unavailable',
    });
    const startRunImpl = () => {
      calls += 1;
      return calls === 1 ? throwError(() => err) : of(sampleRunSummary);
    };
    const { fixture, component, navSpy, startRunSpy } = setup({ startRunImpl });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    await fillValidForm(component, fixture);
    component.onSubmit(new Event('submit'));
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.submitError()?.scope).toBe('page');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="run-start-form"]')).toBeNull();
    expect(root.innerHTML).toContain('Orchestrator unavailable');

    component.retrySubmit();
    await Promise.resolve();
    expect(startRunSpy).toHaveBeenCalledTimes(2);
    expect(navSpy).toHaveBeenCalledWith(['/runs', 'run-new-1']);
  });

  it('network error (status 0) flows to the page-level error', async () => {
    const err = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Unexpected error',
      status: 0,
      code: 'unknown',
    });
    const { fixture, component } = setup({ startRunImpl: () => throwError(() => err) });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    await fillValidForm(component, fixture);
    component.onSubmit(new Event('submit'));
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.submitError()?.scope).toBe('page');
  });

  it('retryLoadAgents re-calls AgentsService.list', async () => {
    let calls = 0;
    const listImpl = () => {
      calls += 1;
      if (calls === 1) {
        return throwError(
          () =>
            new ProblemDetailsError({
              type: 'about:blank',
              title: 'fail',
              status: 0,
              code: 'unknown',
            }),
        );
      }
      return of(sampleAgents);
    };
    const { fixture, component } = setup({ listImpl });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.agentsError()).not.toBeNull();
    component.retryLoadAgents();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.agentsError()).toBeNull();
    expect(component.agents().length).toBe(2);
  });
});
