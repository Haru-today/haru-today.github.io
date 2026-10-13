const { test, expect } = require('@playwright/test');

test('portal loads redesigned sections, stylesheet and exactly two services', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/LABDAM/);
  await expect(page.locator('#main-title')).toBeVisible();
  await expect(page.locator('.atlas-board')).toBeVisible();
  await expect(page.locator('.service-card')).toHaveCount(2);
  await expect(page.locator('#about')).toHaveCount(1);
  await expect(page.locator('#technology')).toHaveCount(1);
  await expect(page.locator('#contact')).toHaveCount(1);
  const style = await page.request.get('/assets/portal-redesign.css');
  expect(style.status()).toBe(200);
  expect(await style.text()).toContain('.hero-grid');
});

test('service links, privacy and disclaimers are preserved', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /LabInsight 이용하기/ }))
    .toHaveAttribute('href', 'https://haru-today.github.io/labinsight/');
  await expect(page.getByRole('link', { name: /Caffeine Atlas 이용하기/ }))
    .toHaveAttribute('href', 'https://haru-today.github.io/caffeine-atlas/');
  await expect(page.getByRole('link', { name: '개인정보 처리 안내' }))
    .toHaveAttribute('href', '/privacy.html');
  await expect(page.getByRole('link', { name: '서비스 이용 안내' }))
    .toHaveAttribute('href', '/terms.html');
  await expect(page.getByText('본 포털 및 연결 서비스는 연구·교육과 참고 정보 제공을 목적으로 하며', { exact: false })).toBeVisible();
  expect((await page.request.get('/privacy.html')).status()).toBe(200);
  expect((await page.request.get('/terms.html')).status()).toBe(200);
});

test('header navigation reaches service section', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav a[href="#services"]').click();
  await expect(page).toHaveURL(/#services$/);
  await expect(page.locator('#services-title')).toBeVisible();
});

test('no horizontal page overflow and primary actions remain on screen', async ({ page }, testInfo) => {
  await page.goto('/');
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.page, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
  const cta = page.getByRole('link', { name: /두 서비스 알아보기/ });
  await expect(cta).toBeVisible();
  const box = await cta.boundingBox();
  expect(box).toBeTruthy();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(dimensions.viewport + 1);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath('labdam-home-fullpage.png'), fullPage: true, animations: 'disabled' });
});

test('keyboard users can skip header to main content', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'iphone-webkit', 'iPhone touch browser uses a different native keyboard focus model');
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('a.skip')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});
