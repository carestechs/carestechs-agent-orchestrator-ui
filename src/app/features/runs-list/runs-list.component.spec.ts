// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Observable, of } from 'rxjs';
import { RunsListComponent } from './runs-list.component';
import { RunsService } from '../../core/runs.service';
import { AgentsService } from '../../core/agents.service';
import { ProblemDetailsError } from '../../core/problem-details.error';
import type { RunSummary } from '../../models';

const sampleRun = (id: string, startedAt: string, status: RunSummary['status'] = 'paused'): RunSummary => ({
  id,
  agentRef: 'demo-agent',
  status,
  intake: { featureBriefPath: 'docs/feat.md' },
  startedAt,
  endedAt: null,
  lastStepNumber: 3,
  terminationReason: null,
});

interface SetupOpts {
  query?: Record<string, string>;
  listImpl?: (filters: unknown) => unknown;
}

function setup(opts: SetupOpts = {}) {
  const listSpy = vi.fn(opts.listImpl ?? (() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } })));
  const agentsSpy = vi.fn(() => of([]));
  const navSpy = vi.fn().mockResolvedValue(true);

  TestBed.configureTestingModule({
    imports: [RunsListComponent],
    providers: [
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(opts.query ?? {}) } },
      },
      {
        provide: Router,
        useValue: {
          navigate: navSpy,
          createUrlTree: vi.fn(() => ({ toString: () => '/runs' })),
          serializeUrl: vi.fn(() => '/runs'),
          events: of(),
          routerState: { root: {} },
        },
      },
      { provide: RunsService, useValue: { list: listSpy } },
      { provide: AgentsService, useValue: { list: agentsSpy } },
    ],
  });

  const fixture = TestBed.createComponent(RunsListComponent);
  return { fixture, component: fixture.componentInstance, listSpy, navSpy };
}

beforeEach(() => {
  TestBed.resetTestingModule();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RunsListComponent', () => {
  it('defaults to status=paused on initial load', async () => {
    const { fixture, listSpy } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    expect(listSpy).toHaveBeenCalled();
    const args = listSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(args['status']).toBe('paused');
    expect(args['page']).toBe(1);
  });

  it('sorts runs by startedAt desc', async () => {
    const runs = [
      sampleRun('a', '2026-05-09T09:00:00Z'),
      sampleRun('b', '2026-05-09T11:00:00Z'),
      sampleRun('c', '2026-05-09T10:00:00Z'),
    ];
    const { fixture, component } = setup({
      listImpl: () => of({ data: runs, meta: { page: 1, pageSize: 20, total: 3 } }),
    });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    const ids = component.sortedRuns().map((r) => r.id);
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('seeds filters from URL query params', async () => {
    const { fixture, component } = setup({ query: { status: 'running', page: '2', agentRef: 'demo' } });
    fixture.detectChanges();
    expect(component.status()).toBe('running');
    expect(component.page()).toBe(2);
    expect(component.agentRef()).toBe('demo');
  });

  it('disables Prev on page 1 and Next at total bound', async () => {
    const { fixture, component } = setup({
      listImpl: () => of({ data: [sampleRun('x', '2026-05-09T10:00:00Z')], meta: { page: 1, pageSize: 20, total: 20 } }),
    });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    expect(component.prevDisabled()).toBe(true);
    expect(component.nextDisabled()).toBe(true);
    component.page.set(2);
    component.pagination.set({ page: 2, pageSize: 20, total: 21 });
    expect(component.prevDisabled()).toBe(false);
    expect(component.nextDisabled()).toBe(true);
  });

  it('filter change pushes to URL and re-fetches', async () => {
    const { fixture, component, listSpy, navSpy } = setup();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    listSpy.mockClear();
    component.onStatusChange('running');
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    expect(navSpy).toHaveBeenCalled();
    const navArgs = navSpy.mock.calls[navSpy.mock.calls.length - 1]![1] as { queryParams: Record<string, unknown> };
    expect(navArgs.queryParams['status']).toBe('running');
    expect(listSpy).toHaveBeenCalled();
  });

  it('does not poll when document.visibilityState !== "visible"', async () => {
    vi.useFakeTimers();
    const { fixture, listSpy } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    listSpy.mockClear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    vi.advanceTimersByTime(15000);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('reloads immediately when visibility flips back to visible', async () => {
    const { fixture, listSpy } = setup();
    fixture.detectChanges();
    await Promise.resolve();
    listSpy.mockClear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(listSpy).toHaveBeenCalled();
  });

  it('removes the visibilitychange listener on destroy', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { fixture } = setup();
    fixture.detectChanges();
    fixture.destroy();
    const calls = removeSpy.mock.calls.filter((c) => c[0] === 'visibilitychange');
    expect(calls.length).toBeGreaterThan(0);
  });

  it('shows full-page error when list rejects with ProblemDetailsError', async () => {
    const err = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Upstream unavailable',
      status: 502,
      code: 'upstream-error',
    });
    // Wrap so each subscription gets a fresh sync-rejection without leaking
    // the same Error instance to the polling tap on later cycles.
    const { fixture, component } = setup({
      // Async error so firstValueFrom's await catches it before zone.js
      // records the rejection as unhandled.
      listImpl: () => new Observable((sub) => {
        const t = setTimeout(() => sub.error(err), 0);
        return () => clearTimeout(t);
      }),
    });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 5));
    fixture.detectChanges();
    expect(component.error()).not.toBeNull();
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Upstream unavailable');
    fixture.destroy();
  });
});
