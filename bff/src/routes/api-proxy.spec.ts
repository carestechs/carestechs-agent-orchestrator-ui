import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetConfigCache } from '../config.js';
import { buildApp } from '../server.js';
import { signSession } from '../session/cookie-session.js';

const PASSPHRASE = 'pass';
const SECRET = 'test-secret';
const API_KEY = 'sk-test-key';

function setEnv(): void {
  process.env['NODE_ENV'] = 'development';
  process.env['SESSION_SECRET'] = SECRET;
  process.env['ORCHESTRATOR_OPERATOR_PASSPHRASE'] = PASSPHRASE;
  process.env['ORCHESTRATOR_BASE_URL'] = 'http://upstream.test';
  process.env['ORCHESTRATOR_API_KEY'] = API_KEY;
}

function validCookie(): string {
  const token = signSession(
    { sub: 'operator', iat: Date.now(), exp: Date.now() + 60_000 },
    SECRET,
  );
  return `op_session=${token}`;
}

let app: FastifyInstance;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setEnv();
  resetConfigCache();
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(async () => {
  await app?.close();
  vi.unstubAllGlobals();
  resetConfigCache();
});

describe('/api/v1/* JSON pass-through', () => {
  it('returns 401 unauthenticated and never calls upstream when no session', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/runs' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(JSON.parse(res.payload).code).toBe('unauthenticated');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards GET with Authorization Bearer and strips inbound Authorization/Cookie', async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"data":[],"meta":{"page":1,"pageSize":20,"total":0}}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/runs?status=paused&page=1&pageSize=20',
      headers: {
        cookie: validCookie(),
        authorization: 'Bearer evil',
      },
    });
    expect(res.statusCode).toBe(200);

    const [calledUrl, init] = fetchSpy.mock.calls[0]!;
    expect(String(calledUrl)).toBe('http://upstream.test/v1/runs?status=paused&page=1&pageSize=20');
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('accept-encoding')).toBe('identity');
  });

  it('passes upstream 200 body through byte-identically', async () => {
    const upstreamBody = '{"data":[{"id":"r1"}],"meta":null}';
    fetchSpy.mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/runs/r1',
      headers: { cookie: validCookie() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe(upstreamBody);
  });

  it.each([409, 404, 422])('passes problem+json status %i through with code intact', async (status) => {
    const problem = JSON.stringify({
      type: 'about:blank',
      title: 't',
      status,
      code: status === 409 ? 'run-already-terminal' : status === 404 ? 'task-not-in-run-memory' : 'invalid-signal-payload',
    });
    fetchSpy.mockResolvedValue(
      new Response(problem, {
        status,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
    app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/runs/r1/signals',
      headers: { cookie: validCookie(), 'content-type': 'application/json' },
      payload: '{"name":"implementation-complete","taskId":"T-1","payload":{}}',
    });
    expect(res.statusCode).toBe(status);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(JSON.parse(res.payload).code).toBeTruthy();
  });

  it('maps fetch rejection to 500 upstream-unavailable', async () => {
    fetchSpy.mockRejectedValue(new TypeError('ECONNREFUSED'));
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/runs',
      headers: { cookie: validCookie() },
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).code).toBe('upstream-unavailable');
  });

  it('maps non-problem upstream 5xx to 502 upstream-error', async () => {
    fetchSpy.mockResolvedValue(
      new Response('boom', { status: 503, headers: { 'content-type': 'text/plain' } }),
    );
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/runs',
      headers: { cookie: validCookie() },
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.payload).code).toBe('upstream-error');
  });

  it('never logs the API key value', async () => {
    fetchSpy.mockResolvedValue(new Response('{"data":[],"meta":null}', { status: 200 }));
    const captured: unknown[] = [];
    app = await buildApp();
    // Wrap the logger to capture.
    const origInfo = app.log.info.bind(app.log);
    app.log.info = ((...args: unknown[]) => {
      captured.push(args);
      return origInfo(...(args as Parameters<typeof origInfo>));
    }) as typeof app.log.info;

    await app.inject({
      method: 'GET',
      url: '/api/v1/runs',
      headers: { cookie: validCookie() },
    });
    const dump = JSON.stringify(captured);
    expect(dump).not.toContain(API_KEY);
    expect(dump).not.toMatch(/Authorization:\s*Bearer/i);
  });
});
