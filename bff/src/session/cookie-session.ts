import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SessionPayload } from './types.js';

export const SESSION_COOKIE_NAME = 'op_session';

function base64url(input: Buffer): string {
  return input.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replaceAll('-', '+').replaceAll('_', '/') + pad, 'base64');
}

function hmac(secret: string, body: string): string {
  return base64url(createHmac('sha256', secret).update(body).digest());
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = hmac(secret, body);
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined, secret: string): SessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 1 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expectedSig = hmac(secret, body);
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(fromBase64url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (!isSessionPayload(payload)) return null;
  if (payload.exp < Date.now()) return null;
  return payload;
}

function isSessionPayload(p: unknown): p is SessionPayload {
  if (typeof p !== 'object' || p === null) return false;
  const r = p as Record<string, unknown>;
  return r['sub'] === 'operator' && typeof r['iat'] === 'number' && typeof r['exp'] === 'number';
}

export interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
  path: string;
  maxAge: number;
}

export function sessionCookieOptions(isProduction: boolean, ttlMs: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: Math.floor(ttlMs / 1000),
  };
}
