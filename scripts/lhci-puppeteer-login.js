// Lighthouse CI invokes this before each navigation. We log in once per page
// and let the cookie persist on the shared browser context so /runs and
// /runs/:id are reachable.
module.exports = async (browser, context) => {
  if (context.url.endsWith('/login')) return;
  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:4200/login', { waitUntil: 'networkidle2' });
    await page.type(
      '[data-testid="login-passphrase"]',
      process.env.E2E_PASSPHRASE || 'e2e-passphrase',
    );
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('[data-testid="login-submit"]'),
    ]);
  } finally {
    await page.close();
  }
};
