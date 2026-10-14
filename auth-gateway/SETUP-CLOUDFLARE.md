# LABDAM 로그인 실제 배포 체크리스트

**2026-10-14 현재 상태: PR #7 개발·테스트용 코드입니다. Cloudflare Worker나 Google Apps Script 운영 배포는 완료되지 않았습니다.**

이 문서는 LABDAM(Personal Health Atlas)을 **공개 홈페이지**로 유지하고, 두 서비스 LabInsight와 Caffeine Atlas만 하나의 **Cloudflare Access 로그인**으로 보호하기 위한 절차입니다.

Cloudflare 계정만 만든 상태라면 팀 이름이나 도메인을 임의로 추측해서 설정하지 마세요. **별도 도메인 구매는 필수가 아닙니다.** Cloudflare가 제공하는 Worker의 `workers.dev` 주소로 시작할 수 있습니다.

## 1. Cloudflare에서 사람이 수행할 초기 설정

1. <https://dash.cloudflare.com/> → **Zero Trust**를 열어 조직(팀)을 생성하고 요금제를 확인합니다. 다른 이름으로 팀을 이미 만들었다면 새로 만들 필요 없습니다.
2. **Settings**에서 본인의 Access team domain을 확인합니다. 형태는 `https://<team>.cloudflareaccess.com`입니다.
3. Access 로그인 제공자는 이메일 일회용 코드(One-time PIN)를 기본으로 사용하고, 정책은 초대할 실제 이메일 주소만 **Allow**합니다. **Everyone / Bypass 정책은 사용하지 않습니다.**
4. 생성할 Worker 이름은 `labdam-protected-services`입니다. 새 Worker의 기본 URL은 `https://labdam-protected-services.<worker-subdomain>.workers.dev` 형태입니다.
5. Cloudflare 대시보드 **Workers & Pages → labdam-protected-services → Access → Protect this Worker behind Access → All traffic** 순으로 보호합니다. *Worker 단위 Access*는 `workers.dev`, 맞춤 도메인, Preview 등 해당 Worker의 경로를 함께 보호하므로 일부 경로가 빠지는 사고를 줄입니다.
6. Access 애플리케이션 설정에서 **Application Audience (AUD) tag**를 확인합니다. 다른 앱의 AUD와 혼동하지 마세요.

공식 문서: <https://developers.cloudflare.com/workers/configuration/cloudflare-access/>

## 2. Worker 배포 전 검증과 환경 변수

GitHub 코드 위치: <https://github.com/Haru-today/haru-today.github.io/pull/7> (Draft).
PR 검증은 실제 Cloudflare 계정에 로그인하거나 배포하지 않습니다.

Node 22+ 환경에서 LABDAM 저장소, LabInsight 저장소, Caffeine Atlas 저장소를 각각 체크아웃하고 테스트합니다. 소스에는 실제 검사결과·유전자 데이터·고객정보를 넣지 않습니다.

```sh
node --test tests/auth-gateway.test.cjs
LABINSIGHT_SOURCE=/path/to/labinsight CAFFEINE_SOURCE=/path/to/caffeine-atlas node auth-gateway/build.mjs
node --test auth-gateway/verify-bundle.test.cjs
```

Cloudflare Workers 배포에 필요한 변수:

| 변수 | 값 | 보호 |
|---|---|---|
| `TEAM_DOMAIN` | 확인된 `https://<team>.cloudflareaccess.com` | 서버 설정 |
| `ACCESS_AUD` | 보호할 Worker Access 앱의 AUD | 서버 설정 |
| `STORAGE_WRITER_EMAILS` | 연구 데이터 저장이 허용된 이메일 주소 목록(쉼표 구분). **명시적으로 지정된 계정만** 사용 가능 | 서버 설정 |
| `CAFFEINE_APPS_SCRIPT_URL` | **검증된 신버전** Apps Script /exec 주소 | 서버 설정 |
| `CAFFEINE_ATLAS_WRITE_HMAC_KEY` | 최소 32자, 강한 무작위 공유 키. Google Apps Script Script Properties에도 같은 값 지정 | **서버 비밀** |

Cloudflare의 `wrangler secret put ... --config auth-gateway/wrangler.jsonc` 명령으로 각 값을 입력할 수 있습니다. **비밀키는 ChatGPT, GitHub 코드·이슈, 웹 화면에 복사하지 마세요.** `STORAGE_WRITER_EMAILS`가 미설정되면 모든 Google Sheets API 접근이 차단됩니다. 데이터 저장 권한이 없는 일반 로그인 사용자는 분석·리포트 다운로드 기능을 사용할 수 있지만 클라우드 저장은 사용할 수 없습니다.

보호용 Worker는 모든 정적 파일에 **선행 JWT 서명 검증**을 요구합니다. 설정이 누락되면 HTTP 503으로 서비스를 **거부**합니다. 개발자가 로그인을 끄는 예외 경로는 제공하지 않습니다.

## 3. 실제 저장 API를 연결하기 전 보안 조건

Caffeine Atlas 보안 PR: <https://github.com/Haru-today/caffeine-atlas/pull/4> (Draft).

- Google Apps Script의 새 코드에서는 `CAFFEINE_ATLAS_SHEET_ID`와 `CAFFEINE_ATLAS_WRITE_HMAC_KEY`를 Script Properties로 관리합니다.
- 구형 공개 Google Apps Script /exec 배포가 남아 있으면 로그인 우회 저장이 가능합니다. 새로운 코드만 배포해도 오래된 **별도 배포**는 직접 차단되지 않을 수 있으므로 **모든 배포 URL**을 확인해야 합니다.
- 기존 Caffeine Atlas 웹앱은 구형 API로 직접 저장하므로, **Worker와 새 Google Apps Script를 각각 독립적으로 운영 반영해서는 안 됩니다.** 통합 테스트가 먼저입니다.
- 실제 개인정보 저장 여부, 목적·보관기간·삭제권한·이용자 동의, Google Sheets 공유자·관리자 권한을 별도로 확인해야 합니다.
- 처음에는 실제 유전자형 대신 **가상 테스트 샘플**만 사용합니다.

## 4. 비로그인/권한 거부/로그인 시나리오

Cloudflare Worker 단위 Access와 JWT 내부 검증을 모두 활성화한 뒤:

1. 로그아웃한 브라우저의 `/labinsight/`, `/labinsight/checkup.html`, `/caffeine-atlas/`, `/caffeine-atlas/caffeine-sensitivity-app/analyzer.html`이 **로그인 요구 또는 접근 거부**가 되는지 확인
2. 보호된 JS/CSS/이미지 URL 직접 접근도 같은 방식으로 막히는지 확인
3. 승인된 이메일로 한 번 로그인한 뒤 두 서비스를 모두 이용 가능한지 확인
4. 보호된 `/caffeine-atlas/caffeine-sensitivity-app/account.html`에서 본인 이메일과 저장 권한, 로그아웃이 표시되는지 확인
5. 미승인 이메일은 `/api/caffeine-atlas` 저장 요청을 할 수 없는지 확인. 저장자 목록 누락 시에는 클라우드 저장이 실패해야 정상
6. 타 출처 POST, 없는 동의, 부적합한 샘플, 관리자 초기화, 위조 토큰, 만료된 토큰이 모두 거부되는지 테스트
7. 로그인 해제 후 **정적 파일·세부 화면·API**까지 다시 차단되고, 이전 오프라인 파일과 다운로드 데이터가 별도로 관리되는지 확인

이 단계의 결과와 로그를 확인하기 전에는 운영 전환하지 않습니다.

## 5. 마지막에만 공개 경로 이전

- LABDAM 메인 두 서비스 버튼을 실제 Worker 보호 호스트로 바꾸고 검증합니다.
- 구형 `https://haru-today.github.io/labinsight/`와 `https://haru-today.github.io/caffeine-atlas/`의 GitHub Pages 공개 서비스를 각각 중단하거나 모든 파일이 접근 불가능한 상태로 전환합니다. **index.html 한 장의 리다이렉트만 바꾸면 하위 URL이 계속 노출됩니다.**
- 오래된 GitHub Pages 캐시, PWA 설치본, 네이티브 앱과 브라우저 다운로드 기록은 웹 전환만으로 폐기되지 않습니다.
- Google Sheets 공유권한 및 Apps Script **과거 배포 URL**을 재점검하고 민감한 실제 자료 저장 전 데이터 정책을 확정합니다.

**남은 관리자 승인 및 직접 설정:** Cloudflare 계정이 이 개발 도구에 연결되어 있지 않아 팀/정책/비밀값/Worker를 대신 생성하거나 활성화할 수 없습니다. 코드가 CI를 통과해도 이는 실제 운영 접속이 인증으로 보호되는 것과 다릅니다.
