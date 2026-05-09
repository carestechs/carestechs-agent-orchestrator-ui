/**
 * GET /api/v1/runs/:id/trace — NDJSON streaming pass-through.
 *
 * This route MUST NOT be wrapped in any compression or response-buffering middleware.
 * Any reverse proxy in front of the BFF must honor `X-Accel-Buffering: no` (nginx) or
 * its equivalent (Cloudflare honors `Cache-Control: no-transform`).
 *
 * Per CLAUDE.md > Patterns to Follow > Trace consumption via ReadableStream and
 * Anti-Patterns to Avoid > No WebSockets / SSE for the trace, the only transport
 * is NDJSON over HTTP.
 */
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { BffConfig } from '../session/types.js';
import { makeRequireSession } from '../session/require-session.js';
import { streamTrace } from '../upstream/orchestrator-client.js';
import { sendProblem } from '../problem.js';

const QUERY_ALLOWLIST = new Set(['follow', 'since', 'kind']);

export function registerTraceRoute(app: FastifyInstance, config: BffConfig): void {
  const requireSession = makeRequireSession(config);

  app.get<{ Params: { id: string } }>(
    '/api/v1/runs/:id/trace',
    { preHandler: requireSession },
    async (req, reply) => {
      const runId = req.params.id;
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query as Record<string, unknown>)) {
        if (!QUERY_ALLOWLIST.has(k)) continue;
        if (Array.isArray(v)) {
          for (const item of v) query.append(k, String(item));
        } else if (v !== undefined && v !== null) {
          query.append(k, String(v));
        }
      }

      const controller = new AbortController();
      const onClose = (): void => controller.abort();
      req.raw.on('close', onClose);

      let upstream: Response;
      try {
        upstream = await streamTrace(runId, query, controller.signal, config);
      } catch (err) {
        req.raw.off('close', onClose);
        if (controller.signal.aborted) return; // client already gone
        req.log.error({ err: (err as Error).name }, 'trace upstream fetch failed');
        await sendProblem(reply, {
          status: 500,
          title: 'Upstream unavailable',
          code: 'upstream-unavailable',
        });
        return;
      }

      // Non-200 paths: read the (small) problem+json body once and forward.
      if (upstream.status === 401) {
        req.raw.off('close', onClose);
        await sendProblem(reply, {
          status: 401,
          title: 'Unauthenticated',
          code: 'unauthenticated',
        });
        return;
      }
      if (upstream.status === 404) {
        req.raw.off('close', onClose);
        const buf = Buffer.from(await upstream.arrayBuffer());
        const ct = upstream.headers.get('content-type') ?? 'application/problem+json';
        reply.code(404).header('content-type', ct).send(buf);
        return;
      }
      if (upstream.status >= 500) {
        req.raw.off('close', onClose);
        await sendProblem(reply, {
          status: 502,
          title: 'Upstream error',
          code: 'upstream-error',
        });
        return;
      }
      if (upstream.status !== 200) {
        req.raw.off('close', onClose);
        const buf = Buffer.from(await upstream.arrayBuffer());
        const ct = upstream.headers.get('content-type') ?? 'application/problem+json';
        reply.code(upstream.status).header('content-type', ct).send(buf);
        return;
      }

      // 200 streaming path — set headers BEFORE writing any body bytes.
      reply
        .raw.setHeader('content-type', 'application/x-ndjson')
        .setHeader('cache-control', 'no-store, no-transform')
        .setHeader('x-accel-buffering', 'no')
        .setHeader('transfer-encoding', 'chunked');
      reply.raw.flushHeaders();

      if (!upstream.body) {
        reply.raw.end();
        req.raw.off('close', onClose);
        return;
      }

      // Tell Fastify we are taking over the raw socket so reply.send() is not used.
      reply.hijack();

      try {
        const upstreamNode = Readable.fromWeb(upstream.body as unknown as import('stream/web').ReadableStream<Uint8Array>);
        await pipeline(upstreamNode, reply.raw);
      } catch (err) {
        // AbortError on client disconnect is expected — ignore it.
        const name = (err as Error).name;
        if (name !== 'AbortError') {
          req.log.error({ err: name }, 'trace pipeline error');
        }
      } finally {
        req.raw.off('close', onClose);
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    },
  );
}
