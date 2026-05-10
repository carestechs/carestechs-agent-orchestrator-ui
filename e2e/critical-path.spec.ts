import { test, expect, type Page } from '@playwright/test';

const E2E_PASSPHRASE = 'e2e-passphrase';
const E2E_API_KEY = 'test-key-do-not-leak';

interface CapturedRequest {
  method: string;
  url: string;
}

function installSecretCapture(page: Page): {
  // After FEAT-003: Authorization: Bearer <api-key> is expected on every
  // orchestrator request. We assert the header IS present with the right
  // value, AND that neither the key (off-channel) nor the passphrase value
  // leaks elsewhere (URL or non-Authorization positions).
  authedRequestCount: { value: number };
  unexpectedKeyExposure: CapturedRequest[];
  passphraseLeaks: CapturedRequest[];
} {
  const authedRequestCount = { value: 0 };
  const unexpectedKeyExposure: CapturedRequest[] = [];
  const passphraseLeaks: CapturedRequest[] = [];
  const expectedBearer = `Bearer ${E2E_API_KEY}`;
  page.on('request', (req) => {
    const auth = req.headers()['authorization'];
    if (auth === expectedBearer) {
      authedRequestCount.value += 1;
    }
    // The API key value must not appear in the URL (would mean someone
    // mistakenly added it as a query param).
    if (req.url().includes(E2E_API_KEY)) {
      unexpectedKeyExposure.push({ method: req.method(), url: req.url() });
    }
    const body = req.postData();
    // The operator passphrase must never leave the browser at all.
    if (req.url().includes(E2E_PASSPHRASE) || (body && body.includes(E2E_PASSPHRASE))) {
      passphraseLeaks.push({ method: req.method(), url: req.url() });
    }
  });
  return { authedRequestCount, unexpectedKeyExposure, passphraseLeaks };
}

test.beforeEach(async ({ request }) => {
  // Restore the upstream mock to a clean run-paused state so each spec is
  // independent of the others.
  await request.post('http://127.0.0.1:4100/__test/reset');
});

test.describe('critical path', () => {
  test('login → list → detail → trace → signal → resubmit', async ({ page }) => {
    const { authedRequestCount, unexpectedKeyExposure, passphraseLeaks } = installSecretCapture(page);

    await page.goto('/login');
    await page.locator('[data-testid="login-passphrase"]').fill(E2E_PASSPHRASE);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/runs');

    await expect(page.locator('[data-testid="runs-table"]')).toBeVisible();
    const row = page.locator('[data-testid="run-row"]').first();
    await expect(row).toBeVisible();
    await row.click();

    await page.waitForURL(/\/runs\/run-e2e-001$/);

    // First trace record paints within 1.5s (loose CI bound for the 1s AC).
    await expect(page.locator('[data-testid="trace-record"]').first()).toBeVisible({
      timeout: 1500,
    });
    await expect(page.locator('[data-testid="trace-record"]')).toHaveCount(3, { timeout: 3000 });

    await expect(page.locator('[data-testid="signal-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="signal-task-id"]')).toHaveValue('task-001');
    await page.locator('[data-testid="signal-commit-sha"]').fill('abcdef1234567');
    await page.locator('[data-testid="signal-pr-url"]').fill('https://example.test/pr/1');
    await page.locator('[data-testid="signal-submit"]').click();

    const successToast = page.locator('[data-testid="toast"][data-variant="success"]').first();
    await expect(successToast).toContainText(/signal received/i);
    await expect(successToast).not.toContainText(/already/i);

    // Resubmit → "already received".
    await page.locator('[data-testid="signal-commit-sha"]').fill('abcdef1234567');
    await page.locator('[data-testid="signal-pr-url"]').fill('https://example.test/pr/1');
    await page.locator('[data-testid="signal-submit"]').click();
    const replayToast = page.locator('[data-testid="toast"][data-variant="success"]').last();
    await expect(replayToast).toContainText(/already received/i);

    // After FEAT-003: Authorization Bearer is the new contract. At least one
    // orchestrator request must have carried it; the key must not leak via
    // URL; the passphrase must not leak anywhere.
    expect(authedRequestCount.value, 'expected Authorization: Bearer on orchestrator requests').toBeGreaterThan(0);
    expect(unexpectedKeyExposure, 'API key must not appear in URLs').toEqual([]);
    expect(passphraseLeaks, 'operator passphrase must never leave the browser').toEqual([]);
  });
});
