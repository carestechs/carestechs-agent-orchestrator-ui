import { afterEach, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetConfigCache } from '../config.js';
import { buildApp } from '../server.js';

const PASSPHRASE = 'correct-horse-battery-staple';

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function fresh(env: Record<string, string | undefined> = {}): Promise<FastifyInstance> {
  setEnv({
    NODE_ENV: 'development',
    SESSION_SECRET: 'test-secret',
    ORCHESTRATOR_OPERATOR_PASSPHRASE: PASSPHRASE,
    ORCHESTRATOR_BASE_URL: 'http://upstream.test',
    ORCHESTRATOR_API_KEY: 'test-api-key',
    ...env,
  });
  resetConfigCache();
  return buildApp();
}

function parseSetCookie(header: string | undefined): {
  raw: string;
  attrs: Record<string, string | true>;
} {
  if (!header) throw new Error('no Set-Cookie header');
  const parts = header.split(';').map((p) => p.trim());
  const attrs: Record<string, string | true> = {};
  // first part is name=value
  parts.slice(1).forEach((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) attrs[part.toLowerCase()] = true;
    else attrs[part.slice(0, eq).toLowerCase()] = part.slice(eq + 1);
  });
  return { raw: header, attrs };
}

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
  resetConfigCache();
});

describe('POST /auth/login', () => {
  it('returns 401 invalid-passphrase on wrong passphrase', async () => {
    app = await fresh();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { passphrase: 'nope' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe('invalid-passphrase');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns 401 on empty passphrase', async () => {
    app = await fresh();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { passphrase: '' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).code).toBe('invalid-passphrase');
  });

  it('sets a httpOnly, sameSite=lax, Path=/ cookie with maxAge >= 28800 on success', async () => {
    app = await fresh();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { passphrase: PASSPHRASE },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.authenticated).toBe(true);
    expect(typeof body.data.expiresAt).toBe('string');

    const setCookieRaw = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookieRaw) ? setCookieRaw[0] : setCookieRaw;
    const { attrs } = parseSetCookie(cookieStr);
    expect(attrs['httponly']).toBe(true);
    expect(String(attrs['samesite']).toLowerCase()).toBe('lax');
    expect(attrs['path']).toBe('/');
    const maxAge = Number(attrs['max-age']);
    expect(maxAge).toBeGreaterThanOrEqual(28_800);
    expect(attrs['secure']).toBeUndefined(); // dev
  });

  it('sets Secure cookie when NODE_ENV=production', async () => {
    app = await fresh({ NODE_ENV: 'production' });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { passphrase: PASSPHRASE },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const setCookieRaw = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookieRaw) ? setCookieRaw[0] : setCookieRaw;
    const { attrs } = parseSetCookie(cookieStr);
    expect(attrs['secure']).toBe(true);
  });
});

describe('POST /auth/logout', () => {
  it('clears the session cookie and returns 204', async () => {
    app = await fresh();
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(204);
    const setCookieRaw = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookieRaw) ? setCookieRaw[0] : setCookieRaw;
    const { attrs } = parseSetCookie(cookieStr);
    // clearCookie sets either Max-Age=0 or an Expires in the past.
    const cleared =
      attrs['max-age'] === '0' ||
      (typeof attrs['expires'] === 'string' && new Date(attrs['expires']).getTime() < Date.now());
    expect(cleared).toBe(true);
  });
});

describe('GET /auth/me', () => {
  it('returns authenticated:false when there is no cookie', async () => {
    app = await fresh();
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      data: { authenticated: false },
      meta: null,
    });
  });

  it('returns authenticated:true with expiresAt when cookie is valid', async () => {
    app = await fresh();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { passphrase: PASSPHRASE },
      headers: { 'content-type': 'application/json' },
    });
    const setCookieRaw = login.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookieRaw) ? setCookieRaw[0] : setCookieRaw;
    const cookieValue = (cookieStr as string).split(';')[0];

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookieValue ?? '' },
    });
    expect(me.statusCode).toBe(200);
    const body = JSON.parse(me.payload);
    expect(body.data.authenticated).toBe(true);
    expect(typeof body.data.expiresAt).toBe('string');
  });

  it('returns authenticated:false when cookie is expired', async () => {
    app = await fresh();
    // Sign a token with exp in the past using the same secret.
    const { signSession } = await import('../session/cookie-session.js');
    const expired = signSession(
      { sub: 'operator', iat: Date.now() - 60_000, exp: Date.now() - 1 },
      'test-secret',
    );
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: `op_session=${expired}` },
    });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.payload).data.authenticated).toBe(false);
  });
});
