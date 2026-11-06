'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const html = fs.readFileSync('index.html','utf8');
test('home follows the current AiApp draft and retains the four-step example', () => {
  for (const text of ['검진 결과를 이해하는 시작<br>담이를 준비하고 있어요','랩담의 서비스','같은 42도, 어떤 기준으로 보느냐에 따라 달라요','결과지 한 장으로 네 단계','리포담으로 시작해 보세요','담이와의 대화는 준비 중']) assert.ok(html.includes(text),text);
  for (const asset of ['repodam.jpg','prodam.jpg','caffeine-atlas.png','site.css','v1.css','fonts.css']) assert.ok(fs.existsSync('assets/aiapp-exact/'+asset),asset);
  assert.doesNotMatch(html, /예시 항목 B|http-equiv="refresh"/);
  assert.match(html, /원본과 대조 \(예시\)/);
  assert.match(html, /aria-controls="main-navigation" aria-expanded="false"/);
  assert.match(html, /href="#main"/);
  assert.match(html, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(html, /임상병리사가|곧 출시|최초|혁신적인|완치|정상이에요|위험해요|FDA 인증 완료/);
});
