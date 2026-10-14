# LABDAM · LabInsight 공동 로그인 (배포 전 검토)

**현재 상태: GitHub PR 개발본이며 Cloudflare 운영 설정과 실제 배포가 완료된 상태가 아닙니다.**

## 인증 범위

| 서비스 | 방문 정책 | 주소 |
| --- | --- | --- |
| LABDAM 브랜드 홈페이지 | Cloudflare Access 로그인 필수 | 새 보호 Worker의 루트 / |
| LabInsight 건강검진 결과 조회 | LABDAM과 동일한 로그인 | 같은 Worker의 /labinsight/ |
| Caffeine Atlas | **로그인 없음 · 공개 서비스 유지** | https://haru-today.github.io/caffeine-atlas/ |

기존 포스터의 QR과 공개 Caffeine Atlas 주소는 유지합니다. **Caffeine Atlas의 로그인 화면, 보호된 별도 복사본, Google Sheets 저장 프록시는 이 Worker에 포함되지 않습니다.** Caffeine Atlas 저장 API의 별도 보안 과제는 학회 QR 공개 여부와 별개입니다.

## 구현된 기능

- Cloudflare Access가 로그인한 사용자에게 발급한 JWT의 RS256 전자서명, 발급자(issuer), 대상(audience), 타입(type), 주체(subject), 만료시각을 **매 요청마다** 검증합니다. 쿠키 이름이나 이메일 헤더만으로 로그인했다고 판단하지 않습니다.
- LABDAM 루트 홈페이지부터 개인정보/약관/계정, CSS, favicon, LabInsight의 HTML/JS/CSS/아이콘까지 Worker 내부에서 인증을 우선 검사합니다.
- /api/session으로 현재 로그인한 본인의 이메일만 조회합니다. 비밀번호는 수집하거나 저장하지 않습니다.
- /account.html 및 /labinsight/account.html의 공동 계정 화면과 /logout Cloudflare Access 로그아웃 URL을 제공합니다.
- 인증된 HTML과 정적 파일에 캐시 금지, 보안 헤더, 검색엔진 색인 제외 정책을 부여합니다.
- 서버 파일, Caffeine Atlas 코드, 실사용자 건강정보와 유전자 데이터는 빌드에 포함하지 않습니다.
- Caffeine Atlas로 이동할 때는 보호 Worker 내부 URL이 아닌 기존 **외부 공개 URL**로 연결합니다.

## 운영상 중요한 한계

**별도의 Cloudflare 로그인 사이트를 개설하는 것만으로 기존 공개 GitHub Pages URL이 보호되지는 않습니다.**

현재 기존 주소:
- https://haru-today.github.io/ — GitHub Pages LABDAM 공개 사이트
- https://haru-today.github.io/labinsight/ — GitHub Pages LabInsight 공개 사이트

새 Worker가 준비되면 위의 **기존 공개 경로 자체**를 없애거나 접근 차단해야 엄밀히 로그인 필수 서비스가 됩니다. 다만 LABDAM 루트 GitHub Pages를 비활성화하면 공개 Caffeine Atlas에서 사용하는 privacy.html과 terms.html 링크가 영향을 받을 수 있으므로, **Caffeine Atlas에 독립된 공개 정책 페이지를 먼저 확보**해야 합니다. 구형 링크를 리다이렉트하는 것만으로는 HTML/JS/API의 공개 경로를 완전히 막을 수 없습니다.

또한 기존 네이티브 LabInsight 앱·설치된 PWA·브라우저 저장 데이터는 새로운 웹 로그인만으로 통제/삭제되지 않습니다. 이 범위는 별도 운영 정책 검토가 필요합니다.

## 로컬/CI 검증

- node --test tests/auth-gateway.test.cjs — 인증, 위조/만료 JWT, 공개 경로 분리, 민감한 정적 파일 차단
- LABINSIGHT_SOURCE=/path/to/labinsight node auth-gateway/build.mjs — LABDAM 메인 + LabInsight 보호용 번들만 생성
- node --test auth-gateway/verify-bundle.test.cjs — 실제 파일 구성, QR 외부 링크, 개인정보 페이지/계정 화면 검수
- node --check auth-gateway/worker.mjs — Worker 구문 검증
- PROTECTED_BASE_URL=https://your-worker.workers.dev node auth-gateway/smoke-anonymous.mjs — **실제 배포 이후에만** 사용하는 비로그인 접근 차단 검사

GitHub Actions는 테스트와 보호용 파일 빌드까지만 진행하고 **배포하지 않습니다**.

## 바로 다음 관리자 작업

[SETUP-CLOUDFLARE.md](./SETUP-CLOUDFLARE.md)의 단계에 따라 Cloudflare Zero Trust에서 인증 팀, 허용 계정, Worker-level Access, Audience(AUD)를 설정합니다. Cloudflare Access 팀/호스트 이름과 운영 도메인은 확인된 실제 값으로만 설정하세요. 비밀번호·API 토큰·JWT·HMAC 키를 GitHub Issue나 채팅에 제공할 필요가 없습니다.

**진행 상태:** 구현과 자동 검증 → 관리자 Cloudflare 설정 → 비공개 시연 URL에서 로그인·로그아웃·LabInsight 리포트 E2E → 기존 공개 경로/법적 링크 전환 → 정식 출시.
