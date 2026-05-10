import { defineConfig } from '@playwright/test';

const E2E_PASSPHRASE = 'e2e-passphrase';
const E2E_API_KEY = 'test-key-do-not-leak';
const E2E_SESSION_SECRET = 'e2e-session-secret-do-not-use-in-prod';
const E2E_UPSTREAM_BASE_URL = 'http://127.0.0.1:4100';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node --import tsx bff/src/server.ts',
      port: 4000,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: '4000',
        ORCHESTRATOR_BASE_URL: E2E_UPSTREAM_BASE_URL,
        ORCHESTRATOR_API_KEY: E2E_API_KEY,
        ORCHESTRATOR_OPERATOR_PASSPHRASE: E2E_PASSPHRASE,
        SESSION_SECRET: E2E_SESSION_SECRET,
      },
    },
    {
      command: 'npm run start',
      port: 4200,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  ],
});

export { E2E_PASSPHRASE, E2E_API_KEY };
