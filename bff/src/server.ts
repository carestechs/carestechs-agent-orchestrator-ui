import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { configSummary, loadConfig } from './config.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTraceRoute } from './routes/trace.js';
import { registerApiProxyRoutes } from './routes/api-proxy.js';

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.isProduction ? 'info' : 'debug',
      // Defensive redaction — values should never reach the logger,
      // but if they do, scrub them.
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.apiKey',
        '*.passphrase',
      ],
    },
    bodyLimit: 2 * 1024 * 1024,
  });

  // Capture /api/v1/* request bodies as raw Buffers so we can forward them
  // byte-identically (preserves AC-2: byte-identical pass-through).
  // Fastify ships a default application/json parser that returns parsed
  // objects; without removeAllContentTypeParsers() it would shadow this
  // custom parser for application/json bodies and req.body would arrive as
  // an object — coerced to "[object Object]" when forwarded via fetch.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer' },
    (req, body, done) => {
      // Only the proxy needs raw buffers; for non-proxy routes we still want JSON.
      if (req.url.startsWith('/api/v1/')) {
        done(null, body);
        return;
      }
      // For auth and healthz, parse JSON when present.
      if (!body || (Buffer.isBuffer(body) && body.length === 0)) {
        done(null, undefined);
        return;
      }
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  await app.register(fastifyCookie, { secret: undefined });

  app.get('/healthz', async () => ({ ok: true }));

  registerAuthRoutes(app, config);
  // Trace must be registered BEFORE the wildcard /api/v1/* forwarder so it wins.
  registerTraceRoute(app, config);
  registerApiProxyRoutes(app, config);

  app.log.info(configSummary(config), 'BFF configured');
  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();
  const config = loadConfig();
  try {
    const address = await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info({ address }, 'BFF listening');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Run when invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  void main();
}
