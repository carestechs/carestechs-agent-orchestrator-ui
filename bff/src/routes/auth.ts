import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BffConfig } from '../session/types.js';
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  signSession,
  verifySession,
} from '../session/cookie-session.js';
import { sendProblem } from '../problem.js';

interface LoginBody {
  passphrase?: unknown;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  // Hash to a fixed length so length mismatch does not short-circuit timing.
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

export function registerAuthRoutes(app: FastifyInstance, config: BffConfig): void {
  app.post('/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as LoginBody;
    const submitted = typeof body.passphrase === 'string' ? body.passphrase : '';

    const matches = submitted.length > 0 && constantTimeStringEqual(submitted, config.operatorPassphrase);
    if (!matches) {
      await sendProblem(reply, {
        status: 401,
        title: 'Invalid passphrase',
        code: 'invalid-passphrase',
      });
      return;
    }

    const iat = Date.now();
    const exp = iat + config.sessionTtlMs;
    const token = signSession({ sub: 'operator', iat, exp }, config.sessionSecret);
    reply.setCookie(
      SESSION_COOKIE_NAME,
      token,
      sessionCookieOptions(config.isProduction, config.sessionTtlMs),
    );
    return reply.code(200).send({
      data: { authenticated: true, expiresAt: new Date(exp).toISOString() },
      meta: null,
    });
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE_NAME];
    const payload = verifySession(cookie, config.sessionSecret);
    if (!payload) {
      return reply.code(200).send({ data: { authenticated: false }, meta: null });
    }
    return reply.code(200).send({
      data: { authenticated: true, expiresAt: new Date(payload.exp).toISOString() },
      meta: null,
    });
  });
}
