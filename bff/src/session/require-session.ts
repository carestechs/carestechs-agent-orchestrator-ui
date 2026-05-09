import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BffConfig } from './types.js';
import { SESSION_COOKIE_NAME, verifySession } from './cookie-session.js';
import { sendProblem } from '../problem.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: { sub: 'operator'; iat: number; exp: number };
  }
}

export function makeRequireSession(config: BffConfig) {
  return async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const cookie = req.cookies[SESSION_COOKIE_NAME];
    const payload = verifySession(cookie, config.sessionSecret);
    if (!payload) {
      await sendProblem(reply, {
        status: 401,
        title: 'Unauthenticated',
        code: 'unauthenticated',
      });
      return;
    }
    req.session = payload;
  };
}
