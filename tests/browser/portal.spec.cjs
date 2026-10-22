const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const WORKER = 'https://labdam-free-approval.jleegenomics.workers.dev/';

test('Google or direct visitors are forwarded to the approved Worker, never to public private apps', async ({ page }) => {
  await page.route('https://labdam-free-approval.jleegenomics.workers.dev/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html lang="ko"><head><title>LABDAM 승인제 Worker 테스트</title></head>' +
        '<body><main id="worker-stub">승인제 Worker로 정상 이동</main></body></html>'
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(WORKER, { timeout: 10000 });
  await expect(page.locator('#worker-stub')).toBeVisible();
});

test('public root HTML is a safe handoff with no app forms, and Caffeine stays public', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain('http-equiv="refresh" content="0;url=' + WORKER + '"');
  expect(body).toContain('href="' + WORKER + 'labinsight/"');
  expect(body).toContain('href="https://haru-today.github.io/caffeine-atlas/"');
  expect(body).toContain('name="robots" content="noindex,nofollow"');
  expect(body).not.toMatch(/<(?:form|input|script)\b/i);
  expect((await request.get('/privacy.html')).status()).toBe(200);
  expect((await request.get('/terms.html')).status()).toBe(200);
});

test('fallback gateway layout is keyboard accessible and has no horizontal scroll', async ({ page }) => {
  const body = await (await page.request.get('/')).text();
  await page.setContent(body.replace(/<meta http-equiv="refresh"[^>]*>/, ''));
  await expect(page.getByRole('link', { name: /LABDAM 홈페이지 열기/ }))
    .toHaveAttribute('href', WORKER);
  await expect(page.getByRole('link', { name: 'REPODAM 바로가기' }))
    .toHaveAttribute('href', WORKER + 'labinsight/');
  await expect(page.getByRole('link', { name: /로그인 없이 공개 이용/ }))
    .toHaveAttribute('href', 'https://haru-today.github.io/caffeine-atlas/');
  await expect(page.locator('main h1')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('fallback gateway has no serious or critical WCAG violations', async ({ page }) => {
  const body = await (await page.request.get('/')).text();
  await page.setContent(body.replace(/<meta http-equiv="refresh"[^>]*>/, ''));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const issues = results.violations.filter(x => ['critical', 'serious'].includes(x.impact));
  expect(issues.map(x => ({ id: x.id, impact: x.impact }))).toEqual([]);
});
