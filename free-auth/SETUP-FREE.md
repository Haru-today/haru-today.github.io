# LABDAM · LabInsight 무료 승인제 로그인 설정서

상태: 2026-10-15 최신 소스 재검증 및 관리자 자동 지정·승인 상태 재확인 UX 보완. **실제 Google OAuth/D1 계정 설정·Workers 운영 배포·기존 공개 주소 차단은 미완료.** 추가 감사 결과와 공개 우회 경로: [AUDIT-20261015.md](./AUDIT-20261015.md).

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
3. 사용자 제공 D1 데이터베이스 UUID를 2026-10-15 개발 브랜치의 `free-auth/wrangler.jsonc` `database_id`에 반영했습니다. UUID는 비밀번호나 API 토큰이 아닙니다. **이는 식별자 형식 확인일 뿐, 실제 Cloudflare 계정에서 해당 데이터베이스 존재·소유권 또는 원격 연결을 검증했다는 의미가 아닙니다.** GitHub CI는 이제 `--require-real-d1`로 누락·형식 오류를 차단합니다.
4. Node.js와 Wrangler(Cloudflare 공식 CLI)로 프로젝트의 무료 데이터베이스 마이그레이션을 적용합니다.

실제 체크아웃한 저장소의 free-auth 폴더에서 실행 예:

    npx wrangler login
    npx wrangler whoami
    npx wrangler d1 migrations list labdam-membership --remote
    npx wrangler d1 migrations apply labdam-membership --remote

**중요:** 위 D1은 사용자가 이미 만들었다고 알려주었으므로 `wrangler d1 create`를 다시 실행하지 않습니다. 처음 실행할 때 마이그레이션 확인 프롬프트에서 대상 DB 이름이 `labdam-membership`인지 확인하세요. `--remote` 없이 실행하면 로컬 데이터베이스에 적용될 수 있습니다. 이 단계는 관리자 컴퓨터에서 본인 Cloudflare 계정에 로그인한 후 실행해야 하며, GitHub CI에서는 원격 DB 테이블을 변경하지 않습니다.

**주의:** 마이그레이션 전에 대상 데이터베이스 이름·UUID가 정확한지 재확인하세요. 다른 연구 데이터를 저장한 시트나 DB를 덮어쓰지 않습니다.

이 D1은 **Google 식별자, 이메일, 표시 이름, 신청 목적, 승인 상태, 임시 OAuth 교환 state, 해시된 로그인 세션**만 저장합니다. 실제 건강검진 결과·검체 정보·카페인 유전자형은 여기에 저장하지 않습니다.

## 2. Google OAuth (일반 Google 로그인)

1. Google Cloud Console에서 프로젝트를 생성하거나 결제 활성화가 불필요한 기존 프로젝트를 선택합니다.
2. Google Auth Platform에서 OAuth 동의 화면을 준비합니다. 개인정보 설명과 앱 연락처를 정확히 입력하고, Web application 유형의 OAuth Client ID를 생성합니다.
3. **현재 확정된 시험 Worker origin**은 `https://labdam-free-approval.jleegenomics.workers.dev`입니다. `wrangler.jsonc` 공개 `vars.AUTH_ORIGIN`에 이를 고정했습니다. **해당 Worker는 아직 생성·배포되지 않았으므로 주소는 아직 실제로 응답하지 않습니다.** Google Cloud Web application OAuth Client의 **Authorized redirect URIs**에는 `https://labdam-free-approval.jleegenomics.workers.dev/auth/callback`을 정확히 등록합니다. 서버측 redirect flow이므로 Authorized JavaScript origins 설정은 필수 아닙니다. 화면에서 요구할 경우 같은 HTTPS origin을 입력할 수 있습니다.
4. Google 공식 안내에 따르면 **기본 신원 범위(openid/email/profile)만 요청하는 앱은 테스트 사용자 허용 목록 제한에 예외가 있습니다.** 따라서 이 범위만으로 가입 신청을 받는 구조를 유지합니다. 다만 실제 인증 화면의 조직 정책, 앱 게시 상태 및 접속 도메인 제약은 계정에서 검증해야 하며, Google 인증 성공도 LABDAM 관리자 승인을 뜻하지 않습니다.
5. 인증 요청은 openid, email, profile 범위만 요구합니다. Gmail/Drive/Contacts 권한을 요청하지 않습니다.
6. Google Client Secret은 GitHub, README, 이슈, 채팅이나 프런트엔드에 절대 저장하지 않습니다.

Google OAuth 사용·게시 심사와 무료 지원 범위는 Google 계정 유형/동의 화면/등록된 도메인에 따라 달라질 수 있습니다. **카드 등록이 필요하면 배포를 중단**하고 다른 무료 경로를 검토하세요.

## 3. Worker 환경 변수와 Secret

Worker에 사용되는 값:
- AUTH_ORIGIN: 시험 Worker의 HTTPS origin `https://labdam-free-approval.jleegenomics.workers.dev` (**공개 설정**, 이미 `wrangler.jsonc` `vars`에 고정됨. 별도 secret 설정 불필요)
- GOOGLE_CLIENT_ID: Google 웹 OAuth 클라이언트 ID (공개 식별자)
- GOOGLE_CLIENT_SECRET: **비밀값**
- RATE_LIMIT_SECRET: **무작위 32자 이상 비밀값**, API 요청 제한에 사용
- BOOTSTRAP_ADMIN_EMAIL: **최초 관리자 본인의 Gmail 또는 기존 Google Workspace 인증 이메일**. 서명 검증된 Gmail 또는 이메일 도메인과 일치하는 `hd`가 있는 Workspace 계정만 최초 admin/approved로 가입됩니다. 외부 이메일로 만든 Google 계정은 이 값과 일치해도 일반 pending 회원입니다. 관리자 지정 때문에 유료 Workspace를 새로 가입하지 마세요. 처음부터 기존 Gmail 계정을 사용하는 것이 가능합니다.
- DB: free-auth/wrangler.jsonc로 연결된 실제 D1 binding
- ASSETS: free-auth/dist 정적 파일 binding. **run_worker_first=true 유지 필수**

예시 작업 명령 (민감값은 쉘 기록이나 GitHub에 노출되지 않도록 Wrangler 대화형 입력 사용):

    npx wrangler secret put GOOGLE_CLIENT_SECRET
    npx wrangler secret put RATE_LIMIT_SECRET
    npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL

GOOGLE_CLIENT_ID는 Cloudflare Worker Secret으로 입력하거나 해당 Worker의 Variables 화면에서 설정합니다. **AUTH_ORIGIN은 이미 소스 설정에 있으므로 중복으로 Secret에 넣지 않습니다.** `wrangler.jsonc` 공개 vars에 Client Secret·RATE_LIMIT_SECRET·개인 이메일 등을 넣지 마세요.

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
- 실제 관리자 로그인과 승인 기능을 확인한 뒤 Worker 설정에서 **BOOTSTRAP_ADMIN_EMAIL을 제거**합니다. 기존 관리자 권한은 D1의 Google 고유 식별자에 연결되어 유지되며, 자동 지정 통로를 계속 열어 두지 않습니다. 이미 일반 회원으로 등록한 계정은 환경 변수 변경만으로 승격되지 않습니다. 관리자 복구·추가 지정은 별도 검토가 필요한 수동 DB 관리 작업입니다.

일반 신청자:
- /login.html → 'Google 계정으로 계속하기'
- 이메일 인증 성공 후 자동으로 pending 등록 → /pending.html
- 승인 대기 화면의 '승인 상태 다시 확인'으로 현재 승인을 조회합니다. 승인 후에는 Google 재로그인 없이 서비스로 이동합니다.
- 필요하면 최대 240자 가입 목적 작성
- **관리자 승인 전에는 LABDAM 홈페이지, LabInsight HTML/JS/CSS/보고서에 접근할 수 없음**
- 관리자는 /admin.html에서 가입 신청자의 이메일, 이름, 이용 목적, 상태 확인 후 승인/거절/대기로 전환
- **기존 승인 철회(거절/대기 전환) 시 해당 회원의 서버 세션을 모두 삭제**합니다. 거절 상태에서 새로 인증한 세션도 재승인 직전에 삭제하므로, 거절 후 재승인된 회원은 Google 로그인이 다시 필요합니다. **첫 pending → approved 전환에서는 기존 pending 세션을 유지**해 재로그인이 필요 없습니다. 탈퇴·로그아웃은 다운로드/열린 화면을 원격 회수하지 않습니다.
- 거절·승인 회수는 D1에서 실시간 검증하므로 **기존 브라우저 세션도 즉시 페이지 차단**
- 같은 세션으로 LABDAM과 LabInsight 이용

**중요:** Google OAuth가 정상이어도 회원 데이터베이스 승인 상태가 approved가 아니면 접근할 수 없습니다. 가입 신청은 승인과 동일하지 않습니다. 일반 회원은 `/account.html` 또는 `/pending.html`에서 CSRF 검증 후 계정 신청 기록 및 로그인 세션을 삭제할 수 있습니다. 관리자는 실수로 유일한 관리자 계정을 지우지 못하도록 이 기능에서 제외됩니다.

## 6. 정식 공개 전 절대 빠뜨리면 안 되는 작업

**기존 공개 GitHub Pages를 남겨두면 보호 Worker만 사용하더라도 로그인 우회가 가능합니다.**

- https://haru-today.github.io/ (기존 LABDAM 루트)
- https://haru-today.github.io/labinsight/ (기존 LabInsight 공개 HTML)

새로운 승인제 사이트에서 모든 흐름이 검증된 뒤 **기존 루트/서브경로의 공개 접근을 끊어야** 합니다. 메인 버튼만 새 주소로 바꾸거나 index.html만 리디렉트하면 하위 파일이 계속 공개되므로 불충분합니다.

**Caffeine Atlas 공개 URL을 무조건 유지하세요.** Caffeine Atlas 전용 안내 페이지는 PR #11로 분리 및 배포했습니다: https://haru-today.github.io/caffeine-atlas/privacy.html , https://haru-today.github.io/caffeine-atlas/terms.html . LABDAM 루트와 LabInsight 공개 주소를 정리하기 전에 실제 익명 접속 및 포스터 QR을 다시 확인하세요.

검수 항목:
- [ ] 관리자 아닌 Google 계정 처음 로그인 → 승인 대기
- [ ] 승인 대기 상태에서 LABDAM /, LabInsight /labinsight/ 직접 접근 거부
- [ ] 관리자 승인 → 두 사이트 재로그인 없이 접근
- [ ] 관리자 권한이 없는 사용자 /admin.html 접근 거부
- [ ] 관리자 승인 회수 후 **기존 세션에서 즉시** LabInsight JS/API 차단; 재승인하더라도 철회 전 세션 재사용 불가 확인
- [ ] CSRF 없이 승인/거절/로그아웃·계정 삭제 불가능
- [ ] 가입 신청 전 `/membership-privacy.html` 개인정보 고지 누구나 열람
- [ ] D1 무료 임시 상태 정리는 하루 한 번 03:15 UTC Cron 실행 확인
- [ ] Caffeine Atlas QR 및 4-SNP/PDF 공개 흐름 변함 없음
- [ ] 서비스 종료·로그아웃과 기기 local/sessionStorage, 다운로드된 파일 삭제는 서로 다른 문제임을 고지
- [ ] `/healthz`의 200은 Google/D1 준비 완료를 뜻하지 않음. 실제 OAuth callback·D1 저장·승인·철회로 준비 상태 확인

**이 문서는 실제 클라우드 배포의 성공을 의미하지 않습니다.** 관리자 계정의 검증된 Cloudflare/Google 정보를 입력하고 현장 테스트가 끝나기 전까지 코드 상태만 유지합니다.


## 7. 익명 공개 Pages 실측 확인 (읽기 전용 · 배포/삭제 없음)

기존 공개 저장소의 LABDAM/LabInsight 직접 접근 문제와 Caffeine Atlas 포스터 URL을 한 번에 검사하는 도구가 있습니다. **쿠키·회원정보 없이 GET만 실행하고 어떤 파일이나 Pages 설정도 변경하지 않습니다.**

    node free-auth/scripts/audit-public-pages.mjs

- `EXPOSED`: 로그인 없이 보호 대상 페이지/JS/CSS가 2xx로 제공되므로 운영 전 조치 필요.
- `CLOSED`: 401/403/404/410. 이전 공개 경로에서는 차단 상태로 분류하지만 링크·캐시·사용자 경험은 별도 확인 필요.
- `PUBLIC`: 포스터 Caffeine Atlas의 지정 공개 주소가 2xx로 열림.
- `REVIEW`: 리디렉션, 5xx, 네트워크 실패/시간 초과 등. 보안을 확인한 것으로 취급하지 않음.

점검 대상은 LabInsight HTML·JS·CSS·manifest·icons·service worker와 Caffeine Atlas 공개 주소 4개입니다. 현재 운영 중인 옛 서비스에서 `EXPOSED`가 나오는 것은 예상되는 미완료 사항이며, **일반 실행은 경고만 출력합니다.** 코드 PR CI에서도 읽기 전용 진단은 성공/실패 게이트로 오해하지 않도록 별도 단계로 표시합니다.

기존 공개 자원 정리 계획을 승인·실행한 **이후에만** 아래 엄격 모드로 재검사합니다.

    node free-auth/scripts/audit-public-pages.mjs --require-cutover

엄격 모드는 보호 대상이 모두 `CLOSED`이고 Caffeine Atlas 4개가 모두 `PUBLIC`일 때만 종료 코드 0을 반환합니다. 이는 물리 QR·기기 캐시·다운로드된 복사본 검증을 대체하지 않습니다. 본 PR에서는 레거시 게시물 삭제·Pages 설정 변경·운영 배포를 하지 않습니다.


## 승인 대기 화면 네트워크·중복 요청 처리

`/pending.html`에서 계정 승인 상태를 `/api/me`로 확인하는 동안에는 가입 목적 저장, 탈퇴, 로그아웃과 재확인 버튼을 일시적으로 비활성화합니다. API가 실패해 세션·CSRF를 확인할 수 없으면 변경 요청을 막고 **승인 상태 다시 확인**으로 복구합니다. 저장·탈퇴·로그아웃 중에도 중복 클릭과 동시 요청을 제한합니다. 거절 상태 계정은 가입 목적을 변경하지 못하지만 로그아웃과 계정 삭제는 가능합니다. 이 프런트엔드 방어는 별개로 Worker에서 현재 승인 상태, CSRF와 Origin을 계속 검증합니다.


## 8. 별도 Workers Free 체험 origin의 익명 접근 검증 (운영 배포 금지)

실제 Google Cloud와 Cloudflare 계정은 사용자가 해당 제공자의 관리 화면에서 직접 설정해야 합니다. 이 저장소에는 실제 OAuth client secret·관리자 이메일·API 토큰을 커밋하지 않습니다. 개발 브랜치 CI는 **시험 Worker를 자동으로 배포하지 않습니다.**

1. Cloudflare 대시보드에서 카드 등록/Workers Paid 전환 없이 기존 Free 플랜으로 계속할 수 있는지 확인하세요. 실제 D1 Free 데이터베이스 `labdam-membership`의 ID는 `wrangler.jsonc`에만 연결하고, 비밀값은 Cloudflare의 Secret 화면에서 직접 입력하세요.
2. 실사용 Worker의 정확한 HTTPS origin을 결정합니다. Google Web OAuth Client의 승인된 리디렉션 URI는 **정확하게** `https://<해당 시험 Worker 호스트>/auth/callback`이어야 합니다. 요청 범위는 `openid email profile`만입니다.
3. 별도로 승인된 시험 환경이 준비된 후, 회원이나 검사 정보 없이 아래 읽기 전용 명령으로 익명 보호 경계부터 검사할 수 있습니다.

    node free-auth/scripts/probe-trial-worker.mjs --origin https://YOUR-TRIAL.workers.dev

점검 대상은 시험 Worker의 공개 로그인/개인정보 안내와, 비로그인 LABDAM·LabInsight HTML 리디렉션, JS/CSS/API 거부, 캐시 방지 헤더, Worker 내 Caffeine Atlas 혼입 여부 및 기존 Caffeine Atlas 공개 URL 4개입니다. `--json`을 추가하면 결과를 JSON으로 출력합니다. **Google 로그인 시작 URL은 요청하지 않으며, D1/회원 데이터를 수정하거나 원격에 배포하지 않습니다.** 실제 Worker가 없다면 실행하지 않아도 됩니다.

**이 검사가 성공해도 배포 준비 완료를 뜻하지 않습니다.** `/healthz`는 상태 코드 검증일 뿐 Google OAuth, D1, 관리자 승인의 준비 상태를 확인하지 않습니다. 이후 실제 Google 계정으로 pending → approved → 접근 허용 → 철회/재승인 → 접근 차단을 별도 수동 검증해야 합니다. 기존 공개 Pages 18개 경로 정리 및 포스터 QR 실기기 검수는 별도입니다.

무료 한도 관련 공식 문서(2026-10-15 확인): D1 Free는 행 읽기 500만/일, 행 쓰기 10만/일, 전체 저장 5 GB이며 개별 DB 최대 500 MB입니다. 2026-09-01부터 무료 일일 한도 초과 D1 쿼리는 리셋 전까지 오류가 발생합니다. 이 프로젝트는 자동 유료 업그레이드를 수행하지 않습니다.


## 9. 정식 공개 전 개인정보 처리 안내 준비 검사

현재 `membership-privacy.html`은 운영자, 비공개 문의 채널, 보관기간, 제공자 처리 고지 중 미확정 사항이 있음을 스스로 밝힙니다. 사용자의 실제 이름·이메일 등을 임의로 게시하지 않습니다.

- 일반 개발 CI의 `node free-auth/scripts/preflight-static.mjs`는 고지의 알려진 누락을 **경고**하지만 테스트 실행은 유지합니다.
- 운영자가 담당자·비공개 문의 수단·회원정보 보관기간·Google/Cloudflare 이용 안내를 실제로 검토해 고지를 변경한 후에만 아래 엄격 검사를 실행합니다.

    node free-auth/scripts/preflight-static.mjs --require-real-d1 --require-final-policy

이는 기존 placeholder 및 요구 항목 존재를 검사하는 제한적인 자동 점검으로, 사업자 실체·DB 실제 연결·법률 준수를 인증하지 않습니다. 원격 배포·기존 Pages 공개 자원 삭제·유료 전환은 수행하지 않습니다.
