// Boots the in-process orchestrator mock on a fixed port (4100) before tests.
// We pin the port (rather than using port 0 + env handoff) because Playwright's
// webServer entries spawn from the runner's env at config-eval time, before
// global setup gets a chance to write to process.env. A fixed port keeps the
// BFF webServer config simple: ORCHESTRATOR_BASE_URL=http://127.0.0.1:4100.
//
// Angular env-file materialization happens in playwright.config.ts at
// config-eval time (before ng serve spawns), not here.
import { createUpstreamMock } from './fixtures/upstream-mock';

export const E2E_UPSTREAM_PORT = 4100;

export default async function globalSetup(): Promise<() => Promise<void>> {
  process.env['E2E_UPSTREAM_PORT'] = String(E2E_UPSTREAM_PORT);
  const mock = createUpstreamMock();
  await mock.start();
  return async () => {
    await mock.stop();
  };
}
