// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiClient } from './api-client';
import { ProblemDetailsError } from './problem-details.error';
import { authExpired } from './auth-events';
import { environment } from '../../environments/environment';

const BASE = environment.orchestratorBaseUrl;
const BEARER = `Bearer ${environment.orchestratorApiKey}`;

let api: ApiClient;
let httpMock: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  api = TestBed.inject(ApiClient);
  httpMock = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  httpMock.verify();
});

describe('ApiClient', () => {
  it('unwraps a 200 envelope into { data, meta }', () => {
    let result: unknown;
    api.get<{ id: string }[]>('/v1/runs').subscribe((r) => (result = r));
    const req = httpMock.expectOne(`${BASE}/v1/runs`);
    expect(req.request.method).toBe('GET');
    // After FEAT-003: no cookies, Authorization is attached on the SPA side.
    expect(req.request.withCredentials).toBe(false);
    expect(req.request.headers.get('Authorization')).toBe(BEARER);
    req.flush({ data: [{ id: 'r1' }], meta: { page: 1, pageSize: 20, total: 1 } });
    expect(result).toEqual({
      data: [{ id: 'r1' }],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });

  it('serializes query params and skips undefined/null', () => {
    api.get('/v1/runs', { status: 'paused', agentRef: undefined, page: 2 }).subscribe();
    const req = httpMock.expectOne((r) => r.url === `${BASE}/v1/runs`);
    expect(req.request.params.get('status')).toBe('paused');
    expect(req.request.params.has('agentRef')).toBe(false);
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ data: [], meta: null });
  });

  it('attaches Authorization: Bearer on POST as well', () => {
    api.post('/v1/runs', { agentRef: 'a', intake: {} }).subscribe();
    const req = httpMock.expectOne(`${BASE}/v1/runs`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe(BEARER);
    expect(req.request.withCredentials).toBe(false);
    req.flush({ data: { id: 'r1' }, meta: null });
  });

  it('maps problem+json 409 to ProblemDetailsError with code intact', () => {
    let caught: unknown;
    api
      .post('/v1/runs/r1/signals', { name: 'implementation-complete', taskId: 'T-1', payload: {} })
      .subscribe({ error: (e) => (caught = e) });
    const req = httpMock.expectOne(`${BASE}/v1/runs/r1/signals`);
    req.flush(
      {
        type: 'about:blank',
        title: 'Run already terminal',
        status: 409,
        code: 'run-already-terminal',
      },
      {
        status: 409,
        statusText: 'Conflict',
        headers: { 'content-type': 'application/problem+json' },
      },
    );
    expect(caught).toBeInstanceOf(ProblemDetailsError);
    const e = caught as ProblemDetailsError;
    expect(e.status).toBe(409);
    expect(e.code).toBe('run-already-terminal');
  });

  it('falls back to code "unknown" on a malformed body', () => {
    let caught: unknown;
    api.get('/v1/runs').subscribe({ error: (e) => (caught = e) });
    const req = httpMock.expectOne(`${BASE}/v1/runs`);
    req.flush('boom', { status: 500, statusText: 'Internal Server Error' });
    expect(caught).toBeInstanceOf(ProblemDetailsError);
    const e = caught as ProblemDetailsError;
    expect(e.status).toBe(500);
    expect(e.code).toBe('unknown');
  });

  it('emits authExpired on any 401 (orchestrator key rotation/revocation)', () => {
    const before = authExpired();
    api.get('/v1/runs').subscribe({ error: () => undefined });
    const req = httpMock.expectOne(`${BASE}/v1/runs`);
    req.flush(
      { type: 'about:blank', title: 'Unauthenticated', status: 401, code: 'unauthenticated' },
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'application/problem+json' },
      },
    );
    expect(authExpired()).toBe(before + 1);
  });
});
