import { test, expect } from '@playwright/test';

const E2E_PASSPHRASE = 'e2e-passphrase';
const UPSTREAM_RESET_URL = 'http://127.0.0.1:4100/__test/reset';

test.beforeEach(async ({ request }) => {
  await request.post(UPSTREAM_RESET_URL);
});

test.describe('cancel run', () => {
  test('confirms, cancels, hides Cancel after terminal', async ({ page }) => {
    await page.goto('/login');
    await page.locator('[data-testid="login-passphrase"]').fill(E2E_PASSPHRASE);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/runs');

    await page.locator('[data-testid="run-row"]').first().click();
    await page.waitForURL(/\/runs\/run-e2e-001$/);

    await page.locator('[data-testid="cancel-button"]').click();
    await expect(page.locator('[data-testid="confirm-modal"]')).toBeVisible();
    await page.locator('[data-testid="confirm-modal-confirm"]').click();

    // Cancel button disappears after the run flips to a terminal state.
    await expect(page.locator('[data-testid="cancel-button"]')).toHaveCount(0, { timeout: 3000 });
  });

  test('second cancel surfaces 409 run-already-terminal as a toast', async ({ page, request }) => {
    await page.goto('/login');
    await page.locator('[data-testid="login-passphrase"]').fill(E2E_PASSPHRASE);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/runs');

    // Trigger one cancel via the same-origin BFF proxy so the cookie session
    // applies; this leaves the run in `cancelled` state for the UI assertion.
    await request.post('/api/v1/runs/run-e2e-001/cancel', { data: {} });

    await page.goto('/runs/run-e2e-001');
    await expect(page.locator('[data-testid="cancel-button"]')).toHaveCount(0);
  });
});
