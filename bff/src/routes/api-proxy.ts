import type { FastifyInstance } from 'fastify';
import type { BffConfig } from '../session/types.js';
import { makeRequireSession } from '../session/require-session.js';
import { forwardJson } from '../upstream/orchestrator-client.js';
import { sendProblem } from '../problem.js';

const HOP_BY_HOP_RESPONSE = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'trailer',
  'upgrade',
]);

export function registerApiProxyRoutes(app: FastifyInstance, config: BffConfig): void {
  const requireSession = makeRequireSession(config);

  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/api/v1/*',
    preHandler: requireSession,
    handler: async (req, reply) => {
      // The trace stream is registered before this wildcard so it always wins;
      // belt-and-braces: skip explicitly here so a registration mistake fails loud.
      const wildcard = (req.params as Record<string, string>)['*'] ?? '';
      const path = `/${wildcard}`;
      if (path.endsWith('/trace')) {
        await sendProblem(reply, {
          status: 500,
          title: 'Trace stream is handled by a dedicated route — registration order regression',
          code: 'upstream-error',
        });
        return;
      }

      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          for (const item of v) query.append(k, String(item));
        } else if (v !== undefined && v !== null) {
          query.append(k, String(v));
        }
      }

      const method = req.method.toUpperCase();
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const body: BodyInit | null = hasBody ? (req.body as Buffer | null) ?? null : null;

      try {
        const upstream = await forwardJson(
          { method, path, query, headers: req.headers, body },
          config,
        );

        // Map upstream → outbound. Pass problem+json through unchanged regardless of status.
        const ct = upstream.headers.get('content-type') ?? '';
        const isProblem = ct.includes('application/problem+json');

        if (!isProblem && upstream.status >= 500 && upstream.status < 600) {
          await sendProblem(reply, {
            status: 502,
            title: 'Upstream error',
            code: 'upstream-error',
          });
          return;
        }

        // Copy headers, dropping hop-by-hop and content-encoding (we don't decompress).
        upstream.headers.forEach((value, name) => {
          if (HOP_BY_HOP_RESPONSE.has(name.toLowerCase())) return;
          reply.header(name, value);
        });
        reply.code(upstream.status).send(Buffer.from(upstream.body));
      } catch (err) {
        // Connect failures (DNS/ECONNREFUSED) — never include err.message in the response.
        req.log.error({ err: (err as Error).name }, 'upstream fetch failed');
        await sendProblem(reply, {
          status: 500,
          title: 'Upstream unavailable',
          code: 'upstream-unavailable',
        });
      }
    },
  });
}
