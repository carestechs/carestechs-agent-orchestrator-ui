// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { SignalsService } from './signals.service';
import { ProblemDetailsError } from './problem-details.error';

let signals: SignalsService;
let httpMock: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  signals = TestBed.inject(SignalsService);
  httpMock = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  httpMock.verify();
});

const baseRequest = {
  name: 'implementation-complete' as const,
  taskId: 'T-001',
  payload: {
    commitSha: 'abc1234',
    prUrl: 'https://github.com/org/repo/pull/42',
    implementationNotes: 'done',
  },
};

const receipt = {
  id: 'sig-1',
  name: 'implementation-complete' as const,
  taskId: 'T-001',
  payload: baseRequest.payload,
  receivedAt: '2026-05-09T10:12:34Z',
};

describe('SignalsService.submit', () => {
  it('POSTs the SignalRequest body to /api/v1/runs/:id/signals', () => {
    signals.submit('r1', baseRequest).subscribe();
    const req = httpMock.expectOne('/api/v1/runs/r1/signals');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(baseRequest);
    req.flush({ data: receipt, meta: null });
  });

  it('returns alreadyReceived: false on a fresh submit', () => {
    let result: unknown;
    signals.submit('r1', baseRequest).subscribe((r) => (result = r));
    httpMock.expectOne('/api/v1/runs/r1/signals').flush({ data: receipt, meta: null });
    expect(result).toEqual({ data: receipt, alreadyReceived: false });
  });

  it('surfaces meta.alreadyReceived: true on replay', () => {
    let result: unknown;
    signals.submit('r1', baseRequest).subscribe((r) => (result = r));
    httpMock
      .expectOne('/api/v1/runs/r1/signals')
      .flush({ data: receipt, meta: { alreadyReceived: true } });
    expect(result).toEqual({ data: receipt, alreadyReceived: true });
  });

  it('propagates 409 run-already-terminal as ProblemDetailsError', () => {
    let caught: unknown;
    signals.submit('r1', baseRequest).subscribe({ error: (e) => (caught = e) });
    httpMock.expectOne('/api/v1/runs/r1/signals').flush(
      { type: 'about:blank', title: 'Run already terminal', status: 409, code: 'run-already-terminal' },
      { status: 409, statusText: 'Conflict', headers: { 'content-type': 'application/problem+json' } },
    );
    expect(caught).toBeInstanceOf(ProblemDetailsError);
    expect((caught as ProblemDetailsError).code).toBe('run-already-terminal');
  });
});
