# LABDAM shared login gateway — implementation staging

**Status (2026-10-13): CODE REVIEW ONLY; NOT DEPLOYED. No login requirement is active on existing GitHub Pages service URLs.**

LABDAM = Personal Health Atlas, the ONE public integrated portal. LabInsight
and Caffeine Atlas remain the only two services. This folder provides
authentication infrastructure and is **not a fourth website**.

## Intended experience

1. Anyone can view the public LABDAM brand homepage.
2. Choosing either service opens ONE protected host with two paths:
   - https://PROTECTED-HOST-TO-CONFIGURE/labinsight/
   - https://PROTECTED-HOST-TO-CONFIGURE/caffeine-atlas/
3. Cloudflare Access authenticates the visitor. Recommended first launch:
   approved email addresses and an email one-time passcode; a Google identity
   provider may be configured separately.
4. A single Cloudflare Access application protects the whole hostname, so
   one login covers both services.
5. Cloudflare Access forwards a Cf-Access-Jwt-Assertion. The Worker checks
   its **RS256 signature, issuer, audience, expiry and human subject** before
   responding with even a single HTML, JS, CSS or image asset.
6. /logout uses the Cloudflare Access logout endpoint. Logging out does not
   automatically erase downloaded reports, browser sessionStorage or
   externally saved records. Preserve the apps' existing deletion controls.

Official references:
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/workers/static-assets/binding/

## CRITICAL: old public URLs bypass the new login

Currently these are publicly accessible GitHub Pages applications:

- https://haru-today.github.io/labinsight/
- https://haru-today.github.io/caffeine-atlas/
- https://haru-today.github.io/caffeine-atlas/caffeine-sensitivity-app/analyzer.html

A JavaScript-only login screen or a gateway at another domain cannot
restrict these old URLs. Changing only the index redirect is insufficient
because the subpages and assets would remain directly accessible. After
the protected host is verified, disable publishing of the two old GitHub
Pages projects (or otherwise make ALL old app files inaccessible).
Keep the LABDAM portal public.

**This PR DOES NOT deploy or claim to enforce login on production.** It
does not configure identity-provider accounts, DNS, secrets, cloud resources,
a user database, or any existing users' passwords.

## Operator launch checklist — do not post credentials in GitHub

- [ ] Verify ownership of a real domain. PROTECTED-HOST-TO-CONFIGURE is a
  placeholder, not an owned or live LABDAM host.
- [ ] Create one Cloudflare Zero Trust Access self-hosted application that
  covers the entire protected hostname, with email OTP or Google IdP,
  an explicit allow policy, and no Everyone or Bypass policy.
- [ ] Note your Access team domain and unique application AUD. Configure
  Worker TEAM_DOMAIN (example https://team.cloudflareaccess.com) and
  ACCESS_AUD via environment secret settings; do not commit personal keys.
- [ ] With reviewed local source checkouts, build static web shells:
      LABINSIGHT_SOURCE=/path/to/labinsight
      CAFFEINE_SOURCE=/path/to/caffeine-atlas
      node auth-gateway/build.mjs
  No patient, research or operational data must be supplied.
- [ ] Verify CI and negative JWT tests before deployment. The Wrangler
  worker asset configuration has run_worker_first=true: every static asset
  requires signed and authorized identity.
- [ ] Deploy manually after Access policy review with Wrangler, for example:
      npx wrangler deploy --config auth-gateway/wrangler.jsonc
  There is NO automatic production deployment.
- [ ] Test anonymous and disallowed users are rejected for BOTH homepages,
  direct subpages, HTML, JS, CSS, image and report routes. Verify one
  approved account may use both after a single login.
- [ ] Caffeine Atlas Google Apps Script / Sheets endpoints also require
  separately authenticated, authorized backend controls. Protecting the
  website does NOT secure a publicly writable API. Do not accept real
  identifiable research/health data until backend auth, lawful consent,
  retention and deletion have been verified.
- [ ] Native LabInsight desktop/Capacitor apps are independent of this
  web-only gateway; old standalone installations cannot be remotely
  disabled by switching web hosting.
- [ ] Once protected routing is verified, change the public LABDAM two
  service buttons to the real host, then disable BOTH old public GitHub
  Pages project publications. Recheck deep links (not only index pages).
- [ ] Implement account lifecycle, verified support/contact, logout
  behavior, data ownership, privacy disclosures and deletion procedures.
  Authentication alone does not certify clinical or legal compliance.

## Files and tests

- worker.mjs: deny-by-default signing-key and token validation.
- wrangler.jsonc: static assets binding, always Worker first.
- build.mjs: whitelisted web shells; no server-side data files.
- verify-bundle.test.cjs: disallow sensitive files and indexable pages.
- tests/auth-gateway.test.cjs: JWT spoofing, expiry, issuer, audience,
  algorithm confusion, missing identity, logout and outage tests.
- .github/workflows/auth-gateway-ci.yml: non-deploy tests and build checks.

The protected LabInsight staging bundle includes a cache-free service worker
to prevent offline loading of protected web pages. The existing production
service worker, OCR, booking demo, reporting, session deletion and native
apps are untouched.

Local review commands (Node 22):

    node --test tests/auth-gateway.test.cjs
    node --check auth-gateway/worker.mjs

After supplying paths to public source checkouts and building:

    node --test auth-gateway/verify-bundle.test.cjs

This workflow does not inspect, store or transmit actual health/genetic records.

## 2026-10-14: Caffeine Atlas 저장 API 인증 프록시 개발

- 보호된 같은 출처에 /api/caffeine-atlas 엔드포인트를 추가했습니다. Cloudflare Access 서명을 검증하지 못하면 GET/POST 모두 차단합니다.
- GET capabilities/saveStatus와 POST 단건·일괄 저장만 허용합니다. 타 출처 POST·원격 setupTemplate·미동의 단건 저장·비정상 일괄 입력은 Google로 전송하지 않습니다.
- Cloudflare Worker의 CAFFEINE_APPS_SCRIPT_URL과 CAFFEINE_ATLAS_WRITE_HMAC_KEY는 **서버 비밀 설정**입니다. 브라우저, 공개 GitHub 저장소, HTML 파일에 넣지 마세요.
- 서버는 요청마다 timestamp와 nonce를 만들고 HMAC-SHA256으로 Apps Script 요청에 서명합니다. 앱은 사이트 내부의 보호 API를 호출하며 기존 공개 script.google.com 직접 전송·JSONP를 보호 번들에서만 제거합니다.
- 대응되는 **Apps Script 변경은 Caffeine Atlas PR #4**에 있습니다: https://github.com/Haru-today/caffeine-atlas/pull/4. Script Properties의 CAFFEINE_ATLAS_WRITE_HMAC_KEY는 Worker와 **동일 값**, CAFFEINE_ATLAS_SHEET_ID는 실제 시트 ID로 설정해야 합니다.
- 두 PR은 모두 **미병합**이고 실제 운영 Cloudflare/Google 배포는 **미실행**입니다. 현재 공개 GitHub Pages 사이트 또는 구형 Apps Script 웹앱은 우회 경로일 수 있습니다.
- 새 프록시 단독 배포로 개인정보 보호가 완성되는 것이 아닙니다. 기존 웹앱의 공개 접근 차단, 운영자만의 시트 권한, 정보주체별 접근, 동의·삭제·보유기간, 실제 브라우저 통합 검증이 필요합니다.

검증: 보안 API/JWT 단위 테스트 21개 및 보호 웹 번들 검증 8개를 GitHub CI에서 실행합니다. 결괏값에 대한 임상적 유효성 판단, 실제 유전자형 저장 데이터 접근, Cloudflare 로그인 계정 생성은 포함하지 않았습니다.
