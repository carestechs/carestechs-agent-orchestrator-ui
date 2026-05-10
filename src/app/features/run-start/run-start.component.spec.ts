// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Location } from '@angular/common';
import { Subject, of, throwError } from 'rxjs';
import { RunStartComponent } from './run-start.component';
import { AgentsService } from '../../core/agents.service';
import { ProblemDetailsError } from '../../core/problem-details.error';
import type { Agent } from '../../models';

const sampleAgents: Agent[] = [
  { ref: 'lifecycle-agent@0.3.0', description: 'Drives the lifecycle.', nodes: [] },
  { ref: 'spec-writer@0.1.2', description: 'Writes specs.', nodes: [] },
];

interface SetupOpts {
  listImpl?: () => unknown;
  historyLength?: number;
}

function setup(opts: SetupOpts = {}) {
  const listSpy = vi.fn(opts.listImpl ?? (() => of(sampleAgents)));
  const backSpy = vi.fn();

  TestBed.configureTestingModule({
    imports: [RunStartComponent],
    providers: [
      provideRouter([]),
      { provide: AgentsService, useValue: { list: listSpy } },
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
  return { fixture, component: fixture.componentInstance, listSpy, navSpy, backSpy };
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

  it('keeps submit disabled while intake is empty and enables it after a valid agent + JSON', async () => {
    vi.useFakeTimers();
    const { fixture, component } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.submitDisabled()).toBe(true);

    component.form.controls.agentRef.setValue('lifecycle-agent@0.3.0');
    component.form.controls.intake.setValue('{ "featureBriefPath": "x.md" }');
    vi.advanceTimersByTime(250);
    fixture.detectChanges();
    expect(component.submitDisabled()).toBe(false);
  });

  it('shows the inline parse error after the 200ms debounce on malformed JSON', async () => {
    vi.useFakeTimers();
    const { fixture, component } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    component.form.controls.intake.setValue('{not json');
    fixture.detectChanges();
    expect(component.intakeErrorMessage()).toBeNull();
    vi.advanceTimersByTime(250);
    fixture.detectChanges();
    expect(component.intakeErrorMessage()).not.toBeNull();
    expect(component.submitDisabled()).toBe(true);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="intake-error"]')).not.toBeNull();
  });

  it('Format button pretty-prints valid intake and is a no-op on invalid', async () => {
    const { fixture, component } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    component.form.controls.intake.setValue('{"a":1,"b":{"c":2}}');
    component.onFormat();
    expect(component.form.controls.intake.value).toBe(JSON.stringify({ a: 1, b: { c: 2 } }, null, 2));

    component.form.controls.intake.setValue('{not json');
    const before = component.form.controls.intake.value;
    component.onFormat();
    expect(component.form.controls.intake.value).toBe(before);
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
