import { test, expect, type Page } from '@playwright/test';

const E2E_PASSPHRASE = 'e2e-passphrase';
const E2E_API_KEY = 'test-key-do-not-leak';

interface CapturedRequest {
  method: string;
  url: string;
}

function installSecretCapture(page: Page): {
  authHeaders: CapturedRequest[];
  keyLeaks: CapturedRequest[];
} {
  const authHeaders: CapturedRequest[] = [];
  const keyLeaks: CapturedRequest[] = [];
  page.on('request', (req) => {
    const auth = req.headers()['authorization'];
    if (auth !== undefined) {
      authHeaders.push({ method: req.method(), url: req.url() });
    }
    const body = req.postData();
    if (req.url().includes(E2E_API_KEY) || (body && body.includes(E2E_API_KEY))) {
      keyLeaks.push({ method: req.method(), url: req.url() });
    }
  });
  return { authHeaders, keyLeaks };
}

test.beforeEach(async ({ request }) => {
  // Restore the upstream mock to a clean run-paused state so each spec is
  // independent of the others.
  await request.post('http://127.0.0.1:4100/__test/reset');
});

test.describe('critical path', () => {
  test('login → list → detail → trace → signal → resubmit', async ({ page }) => {
    const { authHeaders, keyLeaks } = installSecretCapture(page);

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

    // Defense-in-depth: no Authorization header on any browser request, and the
    // upstream API key value never appears in URLs or POST bodies.
    expect(authHeaders, 'no Authorization header on any browser-initiated request').toEqual([]);
    expect(keyLeaks, 'no upstream API key value in any browser request').toEqual([]);
  });
});
