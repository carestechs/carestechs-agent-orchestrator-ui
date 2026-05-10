import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  signSession,
  verifySession,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
} from './cookie-session.js';

const SECRET = 'test-secret-A';
const OTHER_SECRET = 'test-secret-B';

afterEach(() => {
  vi.useRealTimers();
});

describe('cookie-session', () => {
  it('round-trips a fresh session', () => {
    const payload = { sub: 'operator' as const, iat: Date.now(), exp: Date.now() + 60_000 };
    const token = signSession(payload, SECRET);
    expect(verifySession(token, SECRET)).toEqual(payload);
  });

  it('returns null for a tampered body', () => {
    const payload = { sub: 'operator' as const, iat: Date.now(), exp: Date.now() + 60_000 };
    const token = signSession(payload, SECRET);
    const [body, sig] = token.split('.');
    const tampered = `${body}A.${sig}`;
    expect(verifySession(tampered, SECRET)).toBeNull();
  });

  it('returns null for a tampered signature', () => {
    const payload = { sub: 'operator' as const, iat: Date.now(), exp: Date.now() + 60_000 };
    const token = signSession(payload, SECRET);
    const [body, sig] = token.split('.');
    // Pick a replacement char guaranteed not to equal the original last char,
    // otherwise the "tamper" is a no-op when the signature happens to end in
    // that letter (1/64 chance with base64url — flaked once on CI).
    const last = sig?.slice(-1) ?? '';
    const replacement = last === 'A' ? 'B' : 'A';
    const tampered = `${body}.${sig?.slice(0, -1)}${replacement}`;
    expect(verifySession(tampered, SECRET)).toBeNull();
  });

  it('returns null for an expired payload', () => {
    const past = Date.now() - 60_000;
    const payload = { sub: 'operator' as const, iat: past - 60_000, exp: past };
    const token = signSession(payload, SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it('returns null when the wrong secret is used', () => {
    const payload = { sub: 'operator' as const, iat: Date.now(), exp: Date.now() + 60_000 };
    const token = signSession(payload, SECRET);
    expect(verifySession(token, OTHER_SECRET)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(verifySession(undefined, SECRET)).toBeNull();
    expect(verifySession('', SECRET)).toBeNull();
    expect(verifySession('no-dot-here', SECRET)).toBeNull();
    expect(verifySession('.', SECRET)).toBeNull();
  });

  it('emits cookie options with secure flag flipping on isProduction', () => {
    const dev = sessionCookieOptions(false, 8 * 60 * 60 * 1000);
    const prod = sessionCookieOptions(true, 8 * 60 * 60 * 1000);
    expect(dev).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: false });
    expect(prod.secure).toBe(true);
    expect(dev.maxAge).toBe(28_800);
  });

  it('exports the canonical cookie name', () => {
    expect(SESSION_COOKIE_NAME).toBe('op_session');
  });
});
