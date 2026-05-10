#!/usr/bin/env node
// CI shim that boots the same upstream mock the Playwright suite uses, on a
// pinned port (4100). Invoke with `node --import tsx scripts/start-upstream-mock.mjs`
// so the .ts mock can be imported without precompilation.
import { createUpstreamMock } from '../e2e/fixtures/upstream-mock.ts';

process.env.E2E_UPSTREAM_PORT = process.env.E2E_UPSTREAM_PORT || '4100';
const mock = createUpstreamMock();
await mock.start();
console.log(`[upstream-mock] listening on ${mock.baseUrl}`);

const shutdown = async () => {
  console.log('[upstream-mock] shutting down');
  await mock.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
