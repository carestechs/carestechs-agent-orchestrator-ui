import Fastify from 'fastify';

const PORT = Number.parseInt(process.env['PORT'] ?? '4000', 10);
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';

async function start(): Promise<void> {
  const app = Fastify({
    logger: {
      level: NODE_ENV === 'production' ? 'info' : 'debug',
      // Redact secrets defensively — values should never reach the logger,
      // but if they do, scrub them. (CLAUDE.md > BFF (Node) > Never log the orchestrator API key.)
      redact: ['req.headers.authorization', 'req.headers.cookie', '*.apiKey', '*.passphrase'],
    },
  });

  app.get('/healthz', async () => ({ ok: true }));

  try {
    const address = await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info({ address, env: NODE_ENV }, 'BFF listening');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
