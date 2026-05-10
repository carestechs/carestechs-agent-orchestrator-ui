// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RunsService } from './runs.service';
import { clampPageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination';
import { ProblemDetailsError } from './problem-details.error';

let runs: RunsService;
let httpMock: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  runs = TestBed.inject(RunsService);
  httpMock = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  httpMock.verify();
});

describe('clampPageSize', () => {
  it('defaults to 20 for undefined / NaN / <1', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(-5)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
  });
  it('caps at 100', () => {
    expect(clampPageSize(500)).toBe(MAX_PAGE_SIZE);
  });
  it('floors fractional input', () => {
    expect(clampPageSize(20.7)).toBe(20);
  });
});

describe('RunsService.list', () => {
  it('issues GET /api/v1/runs with the documented query params', () => {
    runs.list({ status: 'paused', agentRef: 'lifecycle-agent@0.3.0', page: 2, pageSize: 50 }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/runs');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('status')).toBe('paused');
    expect(req.request.params.get('agentRef')).toBe('lifecycle-agent@0.3.0');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('50');
    req.flush({ data: [], meta: { page: 2, pageSize: 50, total: 0 } });
  });

  it('omits status and agentRef when not given', () => {
    runs.list({}).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/runs');
    expect(req.request.params.has('status')).toBe(false);
    expect(req.request.params.has('agentRef')).toBe(false);
    expect(req.request.params.get('pageSize')).toBe(String(DEFAULT_PAGE_SIZE));
    req.flush({ data: [], meta: { page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0 } });
  });

  it('clamps oversized pageSize to 100', () => {
    runs.list({ pageSize: 999 }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/runs');
    expect(req.request.params.get('pageSize')).toBe(String(MAX_PAGE_SIZE));
    req.flush({ data: [], meta: { page: 1, pageSize: MAX_PAGE_SIZE, total: 0 } });
  });

  it('decodes the response into RunSummary[] + Pagination meta', () => {
    let result: unknown;
    runs.list().subscribe((r) => (result = r));
    const req = httpMock.expectOne((r) => r.url === '/api/v1/runs');
    req.flush({
      data: [
        {
          id: 'r1',
          agentRef: 'lifecycle-agent@0.3.0',
          status: 'paused',
          intake: { featureBriefPath: 'docs/work-items/FEAT-042.md' },
          startedAt: '2026-05-09T09:01:00Z',
          endedAt: null,
          lastStepNumber: 17,
          terminationReason: null,
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
    expect(result).toMatchObject({
      data: [{ id: 'r1', status: 'paused' }],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });
});

describe('RunsService.get', () => {
  it('encodes the runId and returns the unwrapped RunDetail', () => {
    let detail: unknown;
    runs.get('r/1').subscribe((d) => (detail = d));
    const req = httpMock.expectOne('/api/v1/runs/r%2F1');
    expect(req.request.method).toBe('GET');
    req.flush({
      data: {
        id: 'r/1',
        agentRef: 'a',
        status: 'running',
        intake: {},
        startedAt: '2026-05-09T09:00:00Z',
        endedAt: null,
        lastStepNumber: null,
        terminationReason: null,
        traceUri: '/api/v1/runs/r%2F1/trace',
        budget: { maxSteps: 200 },
        currentNode: 'load_work_item',
      },
      meta: null,
    });
    expect(detail).toMatchObject({ id: 'r/1', status: 'running' });
  });
});

describe('RunsService.cancel', () => {
  it('POSTs to /api/v1/runs/:id/cancel and returns the cancelled RunSummary', () => {
    let result: unknown;
    runs.cancel('r1').subscribe((r) => (result = r));
    const req = httpMock.expectOne('/api/v1/runs/r1/cancel');
    expect(req.request.method).toBe('POST');
    req.flush({
      data: {
        id: 'r1',
        agentRef: 'a',
        status: 'cancelled',
        intake: {},
        startedAt: '2026-05-09T09:00:00Z',
        endedAt: '2026-05-09T09:05:00Z',
        lastStepNumber: 18,
        terminationReason: 'cancelled',
      },
      meta: null,
    });
    expect(result).toMatchObject({ status: 'cancelled' });
  });

  it('propagates 409 run-already-terminal as ProblemDetailsError without retry', () => {
    let caught: unknown;
    runs.cancel('r1').subscribe({ error: (e) => (caught = e) });
    const req = httpMock.expectOne('/api/v1/runs/r1/cancel');
    req.flush(
      { type: 'about:blank', title: 'Run already terminal', status: 409, code: 'run-already-terminal' },
      { status: 409, statusText: 'Conflict', headers: { 'content-type': 'application/problem+json' } },
    );
    expect(caught).toBeInstanceOf(ProblemDetailsError);
    expect((caught as ProblemDetailsError).code).toBe('run-already-terminal');
  });
});
