# LABDAM + LabInsight 로그인 실제 배포 체크리스트

**상태: 코드 및 자동 테스트 준비 단계. Cloudflare 대시보드 설정·운영 배포는 아직 수행하지 않았습니다.**

## 목표

- LABDAM 메인 홈페이지 → 로그인 필요
- LabInsight → LABDAM과 동일한 Cloudflare Access 세션 사용
- Caffeine Atlas → **로그인하지 않고 공개 접속**
- 2026년 11월 14일 서울성모병원 학회 포스터의 QR URL **변경·폐쇄 금지**

아래 작업은 Cloudflare 계정의 관리자가 진행해야 합니다. 화면의 실제 메뉴 명칭은 Cloudflare 업데이트에 따라 다를 수 있습니다. 공식 문서: https://developers.cloudflare.com/workers/configuration/cloudflare-access/

## 1. Cloudflare Zero Trust 준비

1. https://dash.cloudflare.com/ 로그인 후 Zero Trust 조직을 생성하거나 기존 조직을 선택합니다.
2. 팀 도메인(Access team domain)을 **실제 계정 설정에서 확인**합니다. 예시는 https://<team>.cloudflareaccess.com 입니다.
3. 로그인 제공자는 이메일 One-time PIN 또는 이미 검증된 Google 등 조직이 허용한 제공자 중 하나를 선택합니다. 기존 Google 비밀번호를 LABDAM 화면에서 직접 받지 않습니다.
4. Cloudflare Access 정책을 설정할 때 처음에는 실제 관리자/테스터 이메일만 Allow로 지정합니다. **Everyone/Bypass 정책을 사용하지 마세요.**
5. LABDAM과 LabInsight는 **하나의 보호 Worker 앱**에 같은 정책을 적용합니다. 각 앱의 로그인 세션이 따로 생기지 않도록 합니다.

## 2. 로그인 보호 Worker 코드 배포

소스: https://github.com/Haru-today/haru-today.github.io/pull/7

- Cloudflare Worker 이름: labdam-protected-services
- Worker 파일: auth-gateway/worker.mjs
- 정적 파일 빌드: auth-gateway/build.mjs → auth-gateway/dist/
- Wrangler 구성: auth-gateway/wrangler.jsonc
- 필수 변수: TEAM_DOMAIN, ACCESS_AUD
- 런타임 요구조건: ASSETS 정적 파일 바인딩, run_worker_first=true

먼저 브랜치의 자동 테스트가 모두 통과했는지 확인하고, 로컬 혹은 승인된 배포 환경에서 검토된 저장소와 LabInsight 원본을 체크아웃해 보호용 번들을 빌드합니다.

    LABINSIGHT_SOURCE=/path/to/labinsight node auth-gateway/build.mjs
    node --test tests/auth-gateway.test.cjs
    node --test auth-gateway/verify-bundle.test.cjs

위 테스트가 통과한 뒤에만 Wrangler/Cloudflare Workers를 이용해 **별도 시험용 Worker URL**을 만듭니다. 필수 변수 TEAM_DOMAIN과 ACCESS_AUD는 실제 Access 앱 정보를 Cloudflare 대시보드에서 확인한 뒤 지정합니다. 비밀번호, 관리자 API 토큰, JWT는 채팅이나 공개 GitHub 저장소에 입력하지 마세요.

Workers 관리자 화면에서 Worker 전체 요청에 대해 Cloudflare Access 보호를 활성화합니다. 루트 /, LabInsight, CSS, JavaScript, 아이콘, /api/session까지 보호하도록 **전체 Worker에 동일한 정책**을 적용합니다.

중요: Worker 코드는 내부에서도 JWT 서명 검증을 수행합니다. Access 인증 정보나 정적 ASSETS 바인딩이 없다면 401/503으로 닫히며, 익명 요청을 원본 공개 GitHub Pages로 우회 전송하지 않습니다.

## 3. Caffeine Atlas는 보호 Worker에 포함하지 않습니다

- 현재 공개 주소: https://haru-today.github.io/caffeine-atlas/
- 보호 Worker의 Caffeine Atlas HTML/JS 복사본은 삭제했습니다.
- 보호 Worker에서 /caffeine-atlas/ 경로는 404로 종료하며, 로그인 화면을 따로 만들지 않습니다.
- LABDAM의 'Caffeine Atlas 공개 체험' 버튼은 **기존 공개 GitHub Pages URL**을 사용합니다.
- 기존 포스터 QR 링크, 학회 방문객의 4-SNP 체험과 로컬 PDF 기능을 유지합니다.
- Caffeine Atlas의 Google Apps Script 저장 API 보안은 별개 과제로 관리합니다. **이번 LABDAM 로그인 배포에는 Google Sheets 프록시를 묶지 않습니다.**

## 4. 로그인 및 권한 통합 테스트

관리자와 테스트용 이메일로 다음을 확인합니다.

- [ ] 로그아웃한 브라우저에서 새 Worker의 /, /index.html, /labinsight/, /labinsight/report.html이 로그인 없이는 200으로 표시되지 않음
- [ ] /assets/portal-redesign.css, /labinsight/app.js 같은 JS/CSS 직접 URL 역시 로그인 보호
- [ ] 같은 계정으로 LABDAM → LabInsight를 이동할 때 별도 재로그인 없이 이용
- [ ] /account.html 및 /labinsight/account.html에서 자기 계정 이메일만 표시
- [ ] /logout 후 페이지 새로고침 및 자산 직접 URL 다시 접근 차단
- [ ] LabInsight OCR 수동 확인/참고범위/모바일 결과표/PDF 인쇄 기존 기능 보존
- [ ] URL에 다른 사람이 만든 가짜 이메일 헤더나 쿠키만 넣어도 우회 불가
- [ ] Caffeine Atlas는 스마트폰에서 **로그인 없이** 접속하고 이미 제출한 포스터 QR이 기존 위치로 이동
- [ ] 테스트에 실제 건강검진 결과·유전자 검사 결과·환자번호 사용 금지

비로그인 자동 점검 (실제 확인한 보호 Worker URL만 입력):

    PROTECTED_BASE_URL=https://<worker>.<subdomain>.workers.dev node auth-gateway/smoke-anonymous.mjs

이 테스트의 200 응답은 보안 실패입니다. 실제 로그인 계정에서의 정상 화면과 로그아웃 테스트는 브라우저에서 별도 검증해야 합니다.

## 5. 기존 공개 GitHub Pages 주소를 반드시 정리

Worker 테스트가 성공하더라도 다음 기존 URL들은 여전히 공개돼 있을 수 있습니다.

- https://haru-today.github.io/ — LABDAM 메인
- https://haru-today.github.io/labinsight/ — LabInsight

**실제 로그인 필수 운영 서비스로 전환하려면 두 공개 GitHub Pages 발행/정적 경로의 우회를 없애야 합니다.** 단순히 메인 버튼만 Worker로 옮기거나 index.html을 리다이렉트하는 것은 보안 통제가 아닙니다. 주요 하위 HTML/JS 깊은 URL도 확인해야 합니다.

특히 Caffeine Atlas 공개 사이트의 개인정보처리방침·이용약관 링크가 지금은 LABDAM 루트의 privacy.html 및 terms.html을 바라볼 수 있습니다. LABDAM 루트 Pages를 중단하기 전에 **Caffeine Atlas에서 로그인 없이 읽을 수 있는 별도 정책 페이지와 링크를 확보**하세요. 그래야 학회 참석자가 Caffeine Atlas 공개 페이지를 정상 이용할 수 있습니다.

GitHub Pages 루트 비활성화가 Caffeine Atlas **별도 저장소의 Pages** 동작에 영향을 주지 않는지 사전에 확인하고, 11월 14일 포스터 QR 실물 스캔을 통과하기 전에는 구형 서비스를 일괄 폐쇄하지 마세요.

## 6. 개인정보와 기기별 오프라인 기능

Cloudflare Access 로그인은 웹 페이지 접속 보호를 위한 기능입니다. 이전에 공개되었던 LabInsight HTML/JS, 설치된 네이티브 앱/PWA 및 사용자 기기의 오프라인 다운로드 파일을 회수하지 못합니다. 기존 건강검진 데이터는 현재 탭의 sessionStorage를 사용하며, 로그아웃이 데이터를 자동 삭제하는 것은 아닙니다.

본격 운영 전 개인정보처리방침에 인증 제공자·수집 항목·보유기간·삭제/문의 경로를 반영해야 합니다.

## 아직 수행하지 않은 작업

- [ ] Cloudflare Zero Trust 팀명 및 앱 AUD 확인
- [ ] 실사용자 로그인 정책 설정 및 Worker-level Access 배포
- [ ] 실제 계정으로 LABDAM + LabInsight 로그인 및 로그아웃 확인
- [ ] Caffeine Atlas 공개 약관/개인정보 페이지를 독립화
- [ ] 기존 공개 LABDAM/ LabInsight GitHub Pages 우회 차단

**배포 완료 여부를 추정하거나 미확인 외부 주소를 만들어 안내하지 마세요.**
