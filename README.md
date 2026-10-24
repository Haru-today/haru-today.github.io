# LABDAM (랩담)

LABDAM은 **Personal Health Atlas의 유일한 통합 포털**입니다. 별도의 네 번째 포털은 운영하지 않습니다.

| 사이트 | 역할 | 주소 |
| --- | --- | --- |
| LABDAM | 통합 포털 · 서비스 소개 | https://haru-today.github.io/ |
| REPODAM | 건강검진 결과 입력·참고 정보 서비스 | https://labdam-free-approval.jleegenomics.workers.dev/labinsight/ |
| Caffeine Atlas | 카페인 유전자 연구·교육용 리포트 | https://haru-today.github.io/caffeine-atlas/ |

Caffeine Atlas의 기존 내부 기능 주소(`caffeine-sensitivity-app/`)는 그대로 유지합니다. 서비스별 임상적 타당성이 확립된 진단 시스템이나 의료기관을 의미하지 않습니다.

## 검색·브랜드
- 포털의 공식 페이지와 canonical: `https://haru-today.github.io/`
- LABDAM(랩담)과 Personal Health Atlas는 **같은 통합 포털**의 브랜드/서비스 설명입니다.
- 도메인 `labdam.kr`은 구매·연결 전까지 실제 운영 주소로 표기하지 않습니다.
- Google/Naver 검색 소유확인 메타데이터, robots.txt 및 sitemap.xml은 계속 유지합니다.

## 개인정보·이용 안내 (2026-10-13)
- <https://haru-today.github.io/privacy.html> — 서비스별 실제 데이터 처리 현황과 미확정 운영사항
- <https://haru-today.github.io/terms.html> — 연구·교육용 이용 범위 및 의료정보 한계
- 운영 담당자·공식 문의, Google Sheets 보관기간/접근권한/삭제절차 및 국외이전 등은 검증 전 사항입니다. 정식 법률 준수 완료가 아닙니다.

## 승인제 웹 서비스 · 공개 페이지 분리 (2026-10-16)

LABDAM 및 REPODAM의 실제 서비스 주소는 Cloudflare Worker `https://labdam-free-approval.jleegenomics.workers.dev/labinsight/`이며 Google 로그인과 D1의 관리자 승인 여부를 서버에서 확인합니다. `https://haru-today.github.io/`는 공개 브랜드·서비스 소개용으로 유지됩니다.

**기존 `https://haru-today.github.io/labinsight/` 주소는 GitHub Pages에서 `main /docs`로 게시 폴더를 전환해야** 검사 입력 화면이 더 이상 정적으로 공개되지 않습니다. 설정 후 해당 주소는 승인제 Worker 안내만 제공합니다. REPODAM 설정: https://github.com/Haru-today/repodam/settings/pages

기존 Caffeine Atlas 학회 포스터 QR 및 `https://haru-today.github.io/caffeine-atlas/` 공개 이용은 유지합니다. GitHub Pages는 서버 인증을 수행하지 못하므로 공개 저장소 코드의 변경만으로 운영자 승인제가 적용되었다고 주장하지 않습니다.

## 2026-10-16 공개 루트 로그인 안내 전환

- `https://haru-today.github.io/`는 Google 검색/직접 접근 모두 **로그인·관리자 승인제가 적용된 Worker**(`https://labdam-free-approval.jleegenomics.workers.dev/`)로 자동 안내합니다. 공개 Pages의 기존 상세 브랜드 소개 화면을 계속 제공하지 않습니다.
- 실제 LABDAM 통합 브랜드 홈페이지와 승인된 REPODAM은 Worker 내부에서 유지합니다. 이미 승인된 브라우저는 세션 쿠키로 바로 들어갈 수 있습니다. 비로그인 시에는 로그인 페이지로 이동하며, 신규 가입은 관리자 승인이 필요합니다.
- 기존 공개 REPODAM Pages는 `main /docs`에서 안내 페이지만 제공하며, 검사 프로그램 정적 자산은 더 이상 제공하지 않습니다.
- Caffeine Atlas 프로젝트 Pages와 학회 포스터 QR은 그대로 공개됩니다. root `robots.txt`는 Caffeine Atlas의 크롤링까지 막지 않도록 유지합니다.
- 검색엔진 결과/스니펫 캐시는 즉시 사라지지 않을 수 있습니다. 로그인 차단의 근거는 검색 결과가 아니라 **Worker 서버의 세션 검증**입니다.
- GitHub 공개 저장소 과거 코드와 사용자 기기에서 이미 캐시된 페이지는 URL 이동이나 Google 검색 비노출만으로 삭제되지 않습니다.

## 2026-10-23 REPODAM 저장소 이름 변경

- REPODAM 앱 소스 저장소 이름을 `Haru-today/labinsight`에서 **`Haru-today/repodam`**으로 변경했습니다(비공개 유지). GitHub는 옛 저장소 주소를 새 이름으로 자동 연결하지만, 같은 계정에 `labinsight`라는 새 저장소를 만들면 그 연결이 끊기므로 만들지 않습니다.
- 수동 배포 workflow의 앱 소스 checkout은 새 이름을 사용합니다. 고정된 앱 커밋 SHA, 읽기 전용 배포 키와 `LABINSIGHT_SOURCE_*` 비밀 이름은 그대로입니다.
- 서비스 주소 경로 `/labinsight/`, 브라우저 저장 키, 앱 ID는 기존 사용자 기록·설치 앱 호환을 위해 바꾸지 않습니다.
- 각 PC의 기존 복제본은 `git remote set-url origin https://github.com/Haru-today/repodam.git`으로 원격 주소를 갱신하세요.

## 2026-10-25 REPODAM 새 화면 배포 준비

- 수동 배포 workflow가 REPODAM `main`의 `b444434`(새 브랜드 화면 1·2단계, Haru-today/repodam#62·#63)를 가져오도록 고정값을 바꿨습니다.
- 승인제 Worker 빌드 스냅숏은 `aab3aeb`입니다. 기존 `53bf3c8`에 REPODAM 브랜드 글꼴 4개(`fonts/*.subset.woff2`, OFL)를 `/labinsight/fonts/`로 복사하는 변경만 더했습니다. 글꼴도 다른 REPODAM 파일처럼 로그인과 승인을 거쳐야 받을 수 있습니다.
- 배포는 여전히 Actions에서 확인 문구를 입력해야만 실행됩니다.

## 2026-10-25 공개 루트를 랩담 원페이지 홈페이지로 전환

- `https://haru-today.github.io/`는 더 이상 Worker로 자동 이동하지 않고, 랩담 원페이지 홈페이지(인스타 프로필 링크용, 390px 모바일 기준)를 보여 줍니다. 위 2026-10-16 항목의 자동 이동은 이 변경으로 대체됩니다.
- 문구·색·글꼴은 LABDAM 디자인 시스템(2026-10-24 첫 판)과 원페이지 시안을 따릅니다. 연락처는 `jleegenomics@gmail.com` 하나입니다.
- 이미 승인된 사용자는 페이지 아래 **승인된 사용자 로그인** 링크로 Worker에 들어갑니다. REPODAM 보호(Worker 세션 검증)는 바뀌지 않습니다.
- 홈페이지 상단에서 리포담과 카페인 아틀라스를 각각 선택할 수 있습니다. 리포담은 기존 로그인·관리자 승인 경로로, 카페인 아틀라스는 기존 공개 주소로 연결합니다. 학회 포스터 QR 주소와 `robots.txt`·`sitemap.xml`은 그대로입니다.
- 검색 노출은 기존처럼 `noindex,nofollow`를 유지합니다. 검색에 노출하려면 메타 태그와 `sitemap.xml`을 함께 바꿔야 합니다.
- 글꼴은 Pretendard·Wanted Sans(OFL)를 페이지에 쓰인 글자만 남겨 `assets/fonts/`에 직접 둡니다(4개 합계 약 120KB, 외부 요청 없음). 문구를 바꾸면 `python scripts/subset-home-fonts.py <전체 woff2 폴더>`를 다시 실행하세요. 빠진 글자는 시스템 글꼴로 보입니다.
