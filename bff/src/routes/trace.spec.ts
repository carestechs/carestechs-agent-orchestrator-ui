import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { resetConfigCache } from '../config.js';
import { buildApp } from '../server.js';
import { signSession } from '../session/cookie-session.js';

const SECRET = 'test-secret';
const API_KEY = 'sk-test-key';

function setEnv(): void {
  process.env['NODE_ENV'] = 'development';
  process.env['SESSION_SECRET'] = SECRET;
  process.env['ORCHESTRATOR_OPERATOR_PASSPHRASE'] = 'pass';
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

function ndjsonStream(chunks: Array<{ delayMs: number; line: string }>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) {
        if (c.delayMs > 0) await new Promise((r) => setTimeout(r, c.delayMs));
        controller.enqueue(enc.encode(c.line));
      }
      controller.close();
    },
  });
}

let upstreamSpy: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  setEnv();
  resetConfigCache();
  upstreamSpy = vi.fn();
  // Only intercept calls to the upstream host; pass test calls to 127.0.0.1 through.
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const s = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (s.startsWith('http://127.0.0.1') || s.startsWith('http://localhost')) {
        return realFetch(url as RequestInfo, init);
      }
      return upstreamSpy(s, init);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetConfigCache();
});

describe('GET /api/v1/runs/:id/trace', () => {
  it('forwards Authorization Bearer and Accept-Encoding: identity', async () => {
    upstreamSpy.mockResolvedValue(
      new Response(ndjsonStream([{ delayMs: 0, line: '{"kind":"step"}\n' }]), {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      }),
    );
    const app = await buildApp();
    await app.listen({ port: 0 });
    const port = (app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/runs/r1/trace?follow=true&since=ignored&kind=step`, {
      headers: { cookie: validCookie() },
    });
    await res.text();
    await app.close();

    const [url, init] = upstreamSpy.mock.calls[0]!;
    expect(String(url)).toBe('http://upstream.test/v1/runs/r1/trace?follow=true&since=ignored&kind=step');
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(headers.get('accept-encoding')).toBe('identity');
    expect(headers.get('accept')).toBe('application/x-ndjson');
  });

  it('returns streaming headers and no Content-Encoding/Content-Length', async () => {
    upstreamSpy.mockResolvedValue(
      new Response(
        ndjsonStream([
          { delayMs: 0, line: '{"a":1}\n' },
          { delayMs: 50, line: '{"b":2}\n' },
        ]),
        { status: 200, headers: { 'content-type': 'application/x-ndjson' } },
      ),
    );
    const app = await buildApp();
    await app.listen({ port: 0 });
    const port = (app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/runs/r1/trace`, {
      headers: { cookie: validCookie() },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-ndjson');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();
    await res.text();
    await app.close();
  });

  it('delivers the first line in <500ms while upstream stalls between lines', async () => {
    upstreamSpy.mockResolvedValue(
      new Response(
        ndjsonStream([
          { delayMs: 10, line: '{"first":true}\n' },
          { delayMs: 2000, line: '{"second":true}\n' },
        ]),
        { status: 200, headers: { 'content-type': 'application/x-ndjson' } },
      ),
    );
    const app = await buildApp();
    await app.listen({ port: 0 });
    const port = (app.server.address() as { port: number }).port;

    const t0 = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/runs/r1/trace`, {
      headers: { cookie: validCookie() },
    });
    const reader = res.body!.getReader();
    const first = await reader.read();
    const firstAt = Date.now();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toContain('"first":true');
    expect(firstAt - t0).toBeLessThan(500);

    await reader.cancel();
    await app.close();
  });

  it('aborts the upstream fetch when the client disconnects', async () => {
    let upstreamSignal: AbortSignal | undefined;
    upstreamSpy.mockImplementation((_url: string, init: RequestInit) => {
      upstreamSignal = init.signal ?? undefined;
      return Promise.resolve(
        new Response(
          ndjsonStream([
            { delayMs: 10, line: '{"a":1}\n' },
            { delayMs: 5000, line: '{"b":2}\n' },
          ]),
          { status: 200, headers: { 'content-type': 'application/x-ndjson' } },
        ),
      );
    });
    const app = await buildApp();
    await app.listen({ port: 0 });
    const port = (app.server.address() as { port: number }).port;

    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/runs/r1/trace`, {
      headers: { cookie: validCookie() },
      signal: ctrl.signal,
    });
    const reader = res.body!.getReader();
    await reader.read(); // consume first line
    ctrl.abort();
    // Give the close event time to bubble through.
    await new Promise((r) => setTimeout(r, 200));
    expect(upstreamSignal?.aborted).toBe(true);
    // Force-close any lingering sockets — the hijacked response otherwise keeps the listener alive.
    app.server.closeAllConnections?.();
    await app.close();
  });

  it('propagates upstream 401 as 401 unauthenticated problem+json', async () => {
    upstreamSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'unauthenticated', title: 't', status: 401 }),
        { status: 401, headers: { 'content-type': 'application/problem+json' } },
      ),
    );
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/runs/r1/trace',
      headers: { cookie: validCookie() },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(JSON.parse(res.payload).code).toBe('unauthenticated');
  });

  it('returns 401 unauthenticated when the SPA has no session cookie', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/runs/r1/trace' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).code).toBe('unauthenticated');
    await app.close();
  });
});
