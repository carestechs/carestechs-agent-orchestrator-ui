import { test, expect } from '@playwright/test';

const E2E_PASSPHRASE = 'e2e-passphrase';

test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:4100/__test/reset');
});

test.describe('start a run', () => {
  test('operator starts a run and lands on detail with trace streaming', async ({ page }) => {
    await page.goto('/login');
    await page.locator('[data-testid="login-passphrase"]').fill(E2E_PASSPHRASE);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/runs');

    // Click the header CTA on /runs.
    await page.locator('[data-testid="start-run-cta-header"]').click();
    await page.waitForURL('**/runs/new');

    // Form mounts; the agent picker is populated from the upstream mock.
    const agentPicker = page.locator('[data-testid="agent-picker"]');
    await expect(agentPicker).toBeVisible();
    await agentPicker.selectOption({ label: 'demo-agent@1.0.0' });

    await page.locator('[data-testid="intake-editor"]').fill(
      JSON.stringify({ featureBriefPath: 'docs/work-items/FEAT-002.md' }, null, 2),
    );

    const submit = page.locator('[data-testid="submit-button"]');
    await expect(submit).toBeEnabled();
    await submit.click();

    // Should land on the started run's detail page with the trace streaming.
    await page.waitForURL(/\/runs\/run-e2e-start-1$/);
    await expect(page.locator('[data-testid="trace-record"]').first()).toBeVisible({
      timeout: 2000,
    });
  });

  test('malformed JSON keeps submit disabled and surfaces an inline error', async ({ page }) => {
    await page.goto('/login');
    await page.locator('[data-testid="login-passphrase"]').fill(E2E_PASSPHRASE);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/runs');

    await page.goto('/runs/new');
    await page.locator('[data-testid="agent-picker"]').selectOption({ label: 'demo-agent@1.0.0' });
    await page.locator('[data-testid="intake-editor"]').fill('{not json');

    // Wait past the 200ms debounce on the inline parse-error display.
    await expect(page.locator('[data-testid="intake-error"]')).toBeVisible({ timeout: 1000 });
    await expect(page.locator('[data-testid="submit-button"]')).toBeDisabled();
  });
});
