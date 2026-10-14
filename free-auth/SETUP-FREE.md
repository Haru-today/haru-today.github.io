# LABDAM · LabInsight 무료 승인제 로그인 설정서

상태: 2026-10-14 코드/가상 계정 자동 테스트 준비. **실제 Google OAuth/D1 계정 설정·Workers 운영 배포·기존 공개 주소 차단은 미완료.**

## 운영 원칙

| 서비스 | 로그인 정책 | 배포 |
| --- | --- | --- |
| LABDAM 브랜드 메인 | 가입 신청 + 관리자 승인 | 이 문서의 Workers Free |
| LabInsight 건강검진 결과 조회 | LABDAM과 같은 승인 세션 | 같은 Workers Free |
| Caffeine Atlas | **로그인 절대 도입하지 않음** | 기존 공개 https://haru-today.github.io/caffeine-atlas/ 유지 |

학회 포스터 QR 주소는 바꾸지 않습니다. 카드 등록, 유료 플랜 전환, 구매, 유료 서비스를 허용하지 않습니다. Cloudflare Access/Zero Trust, 별도 유료 회원관리 SaaS를 사용하지 않습니다.

**무료는 무제한이 아닙니다.** Workers Free 및 D1 Free 사용량 제한에 도달하면 요청/쓰기 기능이 제한될 수 있습니다. 가입/운영 계정 화면에서 결제 카드 입력을 요구하거나 유료 플랜으로 넘어가려는 경우 즉시 중지해야 합니다. 특정 계정이 카드 없이 모든 단계에 접근 가능한지는 실제 가입 UI에서만 확인할 수 있습니다.

공식 문서:
- Workers Free: https://developers.cloudflare.com/workers/platform/limits/
- D1 Free: https://developers.cloudflare.com/d1/platform/pricing/
- Workers static assets + run_worker_first: https://developers.cloudflare.com/workers/static-assets/binding/
- Google 웹 서버 OAuth/동의 화면: https://developers.google.com/identity/protocols/oauth2/web-server

## 1. 무료 Workers + D1 준비

1. Cloudflare 대시보드에서 현재 계정이 **Workers Free**인지 확인합니다. Workers Paid로 전환하지 마세요.
2. D1에서 **labdam-membership**이라는 새 무료 데이터베이스를 만듭니다.
3. 해당 D1 데이터베이스 UUID를 확인해 free-auth/wrangler.jsonc의 REPLACE_WITH_REAL_FREE_D1_DATABASE_ID 값에만 지정합니다. 이 값은 토큰이 아닌 D1 식별자이지만 GitHub PR에서는 실제 값 교체 전에 재검토합니다.
4. Node.js와 Wrangler(Cloudflare 공식 CLI)로 프로젝트의 무료 데이터베이스 마이그레이션을 적용합니다.

실제 체크아웃한 저장소의 free-auth 폴더에서 실행 예:

    npx wrangler d1 create labdam-membership
    npx wrangler d1 migrations apply labdam-membership --remote

**주의:** 마이그레이션 전에 대상 데이터베이스 이름·UUID가 정확한지 재확인하세요. 다른 연구 데이터를 저장한 시트나 DB를 덮어쓰지 않습니다.

이 D1은 **Google 식별자, 이메일, 표시 이름, 신청 목적, 승인 상태, 임시 OAuth 교환 state, 해시된 로그인 세션**만 저장합니다. 실제 건강검진 결과·검체 정보·카페인 유전자형은 여기에 저장하지 않습니다.

## 2. Google OAuth (일반 Google 로그인)

1. Google Cloud Console에서 프로젝트를 생성하거나 결제 활성화가 불필요한 기존 프로젝트를 선택합니다.
2. Google Auth Platform에서 OAuth 동의 화면을 준비합니다. 개인정보 설명과 앱 연락처를 정확히 입력하고, Web application 유형의 OAuth Client ID를 생성합니다.
3. 승인된 JavaScript origin은 보호 Worker의 HTTPS origin, 승인된 redirect URI는 정확히 https://<실제 Worker 호스트>/auth/callback 으로 등록합니다.
4. 신규 외부 Google OAuth 앱이 테스트 모드라면 **Google에 등록한 테스트 사용자만 로그인할 수 있습니다.** 외부 지원자가 가입 신청할 수 있도록 하려면 Google 앱 공개 설정/인증 정책을 별도로 확인해야 합니다. 테스트 단계에서는 본인과 승인한 테스터만 등록하세요.
5. 인증 요청은 openid, email, profile 범위만 요구합니다. Gmail/Drive/Contacts 권한을 요청하지 않습니다.
6. Google Client Secret은 GitHub, README, 이슈, 채팅이나 프런트엔드에 절대 저장하지 않습니다.

Google OAuth 사용·게시 심사와 무료 지원 범위는 Google 계정 유형/동의 화면/등록된 도메인에 따라 달라질 수 있습니다. **카드 등록이 필요하면 배포를 중단**하고 다른 무료 경로를 검토하세요.

## 3. Worker 환경 변수와 Secret

Worker에 사용되는 값:
- AUTH_ORIGIN: 실제 Worker의 HTTPS origin, 예: https://YOUR-WORKER.workers.dev
- GOOGLE_CLIENT_ID: Google 웹 OAuth 클라이언트 ID (공개 식별자)
- GOOGLE_CLIENT_SECRET: **비밀값**
- RATE_LIMIT_SECRET: **무작위 32자 이상 비밀값**, API 요청 제한에 사용
- BOOTSTRAP_ADMIN_EMAIL: **최초 관리자 본인의 실제 Google 인증 이메일**. 본인 계정에서 최초 인증 성공할 때만 admin/approved로 가입됩니다.
- DB: free-auth/wrangler.jsonc로 연결된 실제 D1 binding
- ASSETS: free-auth/dist 정적 파일 binding. **run_worker_first=true 유지 필수**

예시 작업 명령 (민감값은 쉘 기록이나 GitHub에 노출되지 않도록 Wrangler 대화형 입력 사용):

    npx wrangler secret put GOOGLE_CLIENT_SECRET
    npx wrangler secret put RATE_LIMIT_SECRET
    npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL

AUTH_ORIGIN 및 GOOGLE_CLIENT_ID도 Wrangler 비밀값 설정이나 Worker Variables 화면에서 직접 설정 가능합니다.

**선행 조건:** 실제 Google redirect URI를 먼저 정한 다음에 Workers secret을 설정합니다. 설정 완료 전에는 OAuth 코드교환이 진행되지 않도록 503으로 닫히는 구조입니다. 승인용 앱 운영 주체와 가입 심사 고지·보존 기간도 정해야 합니다.

## 4. 코드 검증 및 배포

검증하려는 checkout에 이 PR의 free-auth 폴더가 있어야 합니다. LABDAM과 최신 LabInsight 소스가 같은 빌드 작업 공간에 존재해야 합니다.

    node --check free-auth/worker.mjs
    node --test tests/free-auth.test.cjs
    LABINSIGHT_SOURCE=/path/to/labinsight node free-auth/build.mjs
    node --test free-auth/tests/bundle.test.cjs

위 검증을 먼저 통과합니다. 그 다음 Wrangler를 통한 시험 Worker 배포를 수행합니다.

    cd free-auth
    npx wrangler deploy

**실제 배포 전 필수:** wrangler.jsonc의 D1 ID를 확인하고, D1 마이그레이션·모든 secrets·구글 OAuth 리디렉션을 등록하세요. 테스트 중 과금 가능성을 암시하는 화면이 나오면 해당 절차를 중단합니다. GitHub Actions는 자동 배포하거나 결제하지 않습니다.

## 5. 회원가입과 관리

최초 관리자:
- BOOTSTRAP_ADMIN_EMAIL에 등록한 **본인 Google 계정**으로 /login.html에서 인증
- D1에 자동으로 admin/approved 회원 기록 생성
- /account.html에서 '회원 승인 관리'로 이동 → /admin.html

일반 신청자:
- /login.html → 'Google 계정으로 계속하기'
- 이메일 인증 성공 후 자동으로 pending 등록 → /pending.html
- 필요하면 최대 240자 가입 목적 작성
- **관리자 승인 전에는 LABDAM 홈페이지, LabInsight HTML/JS/CSS/보고서에 접근할 수 없음**
- 관리자는 /admin.html에서 가입 신청자의 이메일, 이름, 이용 목적, 상태 확인 후 승인/거절/대기로 전환
- 거절·승인 회수는 D1에서 실시간 검증하므로 **기존 브라우저 세션도 즉시 페이지 차단**
- 같은 세션으로 LABDAM과 LabInsight 이용

**중요:** Cloudflare OAuth가 정상이어도 회원 데이터베이스 승인 상태가 approved가 아니면 접근할 수 없습니다. 가입 신청은 승인과 동일하지 않습니다.

## 6. 정식 공개 전 절대 빠뜨리면 안 되는 작업

**기존 공개 GitHub Pages를 남겨두면 보호 Worker만 사용하더라도 로그인 우회가 가능합니다.**

- https://haru-today.github.io/ (기존 LABDAM 루트)
- https://haru-today.github.io/labinsight/ (기존 LabInsight 공개 HTML)

새로운 승인제 사이트에서 모든 흐름이 검증된 뒤 **기존 루트/서브경로의 공개 접근을 끊어야** 합니다. 메인 버튼만 새 주소로 바꾸거나 index.html만 리디렉트하면 하위 파일이 계속 공개되므로 불충분합니다.

**Caffeine Atlas의 공개 URL은 무조건 유지**하되, 현재 LABDAM 루트의 privacy.html·terms.html 링크는 LABDAM 루트를 보호/중단하면 열리지 않을 수 있습니다. 공개 Caffeine Atlas 전용 법적 고지 링크를 별도로 만들어 공개 접속 가능하게 해야 합니다. 추적 이슈: https://github.com/Haru-today/caffeine-atlas/issues/10.

검수 항목:
- [ ] 관리자 아닌 Google 계정 처음 로그인 → 승인 대기
- [ ] 승인 대기 상태에서 LABDAM /, LabInsight /labinsight/ 직접 접근 거부
- [ ] 관리자 승인 → 두 사이트 재로그인 없이 접근
- [ ] 관리자 권한이 없는 사용자 /admin.html 접근 거부
- [ ] 관리자 승인 회수 후 **기존 세션에서 즉시** LabInsight JS/API 차단
- [ ] CSRF 없이 승인/거절/로그아웃 불가능
- [ ] Caffeine Atlas QR 및 4-SNP/PDF 공개 흐름 변함 없음
- [ ] 서비스 종료·로그아웃과 기기 local/sessionStorage, 다운로드된 파일 삭제는 서로 다른 문제임을 고지

**이 문서는 실제 클라우드 배포의 성공을 의미하지 않습니다.** 관리자 계정의 검증된 Cloudflare/Google 정보를 입력하고 현장 테스트가 끝나기 전까지 코드 상태만 유지합니다.
