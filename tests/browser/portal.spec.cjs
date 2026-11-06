const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const WORKER = 'https://labdam-free-approval.jleegenomics.workers.dev/';

test('AiApp homepage and its locally hosted visual assets render', async ({page,baseURL}) => {
  await page.goto('/',{waitUntil:'load'}); await page.evaluate(()=>document.fonts.ready);
  await expect(page).toHaveURL(new URL('/',baseURL).href);
  await expect(page.getByRole('heading',{level:1})).toHaveText('검진 결과를 이해하는 시작담이를 준비하고 있어요');
  for (const label of ['검진 결과지 옆에서 노트에 질문을 적는 모습','연구용 서열 분석 도구를 연상시키는 코드 화면','Caffeine Atlas 워드마크 로고']) {
    const image=page.getByRole('img',{name:label}); await image.scrollIntoViewIfNeeded();
    await expect(image).toBeVisible(); expect(await image.evaluate(e=>e.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByRole('heading',{name:'같은 42도, 어떤 기준으로 보느냐에 따라 달라요'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'결과지 한 장으로 네 단계'})).toBeVisible();
  await expect(page.getByText('예시 항목 B')).toHaveCount(0);
  for(const element of await page.locator('main h2,main img').all()) expect(await element.evaluate(e=>getComputedStyle(e).opacity)).toBe('1');
});

test('service routes, safe script and no data input are preserved', async ({page,request}) => {
  await page.goto('/');
  await expect(page.getByRole('link',{name:'리포담 시작하기',exact:true}).first()).toHaveAttribute('href',WORKER+'labinsight/');
  await expect(page.getByRole('link',{name:'프로담 시작하기',exact:true}).first()).toHaveAttribute('href','https://prodam.labdam.kr/');
  await expect(page.getByRole('link',{name:'Caffeine Atlas 열기'})).toHaveAttribute('href','https://haru-today.github.io/caffeine-atlas/');
  await expect(page.locator('form,input,textarea,select,iframe')).toHaveCount(0);
  await expect(page.locator('script')).toHaveCount(2);
  for(const path of ['/privacy.html','/terms.html','/assets/aiapp-exact/home.js']) expect((await request.get(path)).status(),path).toBe(200);
  const dimensions=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,page:document.documentElement.scrollWidth}));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport+1);
});

test('mobile menu opens and closes accessibly', async ({page},info) => {
  test.skip(info.project.name==='desktop-chromium','mobile viewports only');
  await page.goto('/'); const toggle=page.getByRole('button',{name:'메뉴 열기'});
  await expect(toggle).toBeVisible(); await toggle.click();
  await expect(page.getByRole('button',{name:'메뉴 닫기'})).toHaveAttribute('aria-expanded','true');
  await expect(page.getByRole('navigation',{name:'주 메뉴'}).getByRole('link',{name:'이용 방법·FAQ'})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(toggle).toHaveAttribute('aria-expanded','false'); await expect(toggle).toBeFocused();
});

test('desktop step illustrations follow scrolling', async ({page},info) => {
  test.skip(info.project.name!=='desktop-chromium','desktop layout only');
  await page.goto('/'); await page.getByRole('heading',{name:'물어볼 질문'}).scrollIntoViewIfNeeded();
  await expect(page.locator('[data-step-view][data-active]')).toHaveCount(1);
  await expect(page.locator('[data-step-view]').nth(3)).toHaveAttribute('data-active','');
  await expect(page.locator('[data-step-view] a,[data-step-view] button,[data-step-view] input,[data-step-view] [tabindex]')).toHaveCount(0);
});

test('navigation remains usable without JavaScript', async ({browser,baseURL},info) => {
  test.skip(!['desktop-chromium','narrow-320'].includes(info.project.name),'desktop and smallest phone only');
  const context=await browser.newContext({javaScriptEnabled:false,viewport:info.project.name==='narrow-320'?{width:320,height:720}:{width:1440,height:900}});
  const page=await context.newPage(); await page.goto(baseURL);
  const nav=page.getByRole('navigation',{name:'주 메뉴'});
  await expect(nav.getByRole('link',{name:'이용 방법·FAQ'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(info.project.name==='narrow-320'?321:1441);
  await context.close();
});

for(const colorScheme of ['light','dark']) test(`homepage has no serious WCAG issues (${colorScheme})`,async ({page})=>{
  await page.emulateMedia({colorScheme}); await page.goto('/');
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(result.violations.filter(x=>['serious','critical'].includes(x.impact)).map(x=>({id:x.id,nodes:x.nodes.map(n=>n.target)}))).toEqual([]);
});
