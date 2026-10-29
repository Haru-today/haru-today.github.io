const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const WORKER = 'https://labdam-free-approval.jleegenomics.workers.dev/';

test('visitors stay on the public homepage instead of being forwarded', async ({ page, baseURL }) => {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page).toHaveURL(new URL('/', baseURL).href);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('검진 결과, 내 결과지 기준으로 보세요');
  await expect(page.getByRole('img', { name: 'LABDAM' })).toBeVisible();
});

test('public root has only site metadata and no app forms or scripts', async ({ request, page }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).not.toContain('http-equiv="refresh"');
  expect(body).toContain('href="' + WORKER + 'login.html"');
  expect(body).toContain('name="robots" content="index,follow"');
  expect(body).toContain('rel="canonical" href="https://labdam.kr/"');
  await page.goto('/');
  await expect(page.locator('form, input')).toHaveCount(0);
  await expect(page.locator('script')).toHaveCount(1);
  await expect(page.locator('script')).toHaveAttribute('type', 'application/ld+json');
  expect(JSON.parse(await page.locator('script').textContent()).name).toBe('랩담');
  for (const path of ['/privacy.html', '/terms.html', '/assets/labdam-logo.svg',
    ...[...body.matchAll(/url\("([^"]+)"\)/g)].map(match => match[1])]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

test('homepage links work by keyboard and the page has no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  const ask = page.getByRole('link', { name: '리포담 시작하기', exact: true });
  await expect(ask).toHaveAttribute('href', WORKER + 'labinsight/');
  await expect(page.getByRole('navigation', { name: '바로가기' }).getByRole('link', { name: '카페인 아틀라스', exact: true }))
    .toHaveAttribute('href', '/caffeine-atlas/caffeine-sensitivity-app/index.html');
  for (const name of ['문의', '이메일로 물어보기']) {
    await expect(page.getByRole('link', { name })).toHaveAttribute('href', 'mailto:jleegenomics@gmail.com');
  }
  const faq = page.getByText('진단해 주나요?');
  await faq.click();
  await expect(page.getByText('리포담은 진단하지 않습니다', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: '리포담 로그인' })).toHaveAttribute('href', WORKER + 'login.html');
  await expect(page.getByRole('link', { name: '개인정보 처리 안내' })).toHaveAttribute('href', '/privacy.html');
  // WebKit skips links on Tab by default, so focus the skip link directly and check it appears.
  const skip = page.getByRole('link', { name: '본문으로 바로가기' });
  await skip.focus();
  expect((await skip.boundingBox()).x).toBeGreaterThanOrEqual(0);
  const box = await ask.first().boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('the hero fits in the first screen on phones', async ({ page }, testInfo) => {
  test.skip(!['android-chromium', 'iphone-webkit'].includes(testInfo.project.name), 'phone viewports only');
  await page.goto('/');
  const start = page.getByRole('link', { name: '리포담 시작하기', exact: true });
  const box = await start.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
});

for (const colorScheme of ['light', 'dark']) {
  test(`homepage has no serious or critical WCAG violations (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const issues = results.violations.filter(x => ['critical', 'serious'].includes(x.impact));
    expect(issues.map(x => ({ id: x.id, impact: x.impact }))).toEqual([]);
  });
}
