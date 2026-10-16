# LABDAM (랩담)

LABDAM은 **Personal Health Atlas의 유일한 통합 포털**입니다. 별도의 네 번째 포털은 운영하지 않습니다.

| 사이트 | 역할 | 주소 |
| --- | --- | --- |
| LABDAM | 통합 포털 · 서비스 소개 | https://haru-today.github.io/ |
| LabInsight | 건강검진 결과 입력·참고 정보 서비스 | https://labdam-free-approval.jleegenomics.workers.dev/labinsight/ |
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

LABDAM 및 LabInsight의 실제 서비스 주소는 Cloudflare Worker `https://labdam-free-approval.jleegenomics.workers.dev/labinsight/`이며 Google 로그인과 D1의 관리자 승인 여부를 서버에서 확인합니다. `https://haru-today.github.io/`는 공개 브랜드·서비스 소개용으로 유지됩니다.

**기존 `https://haru-today.github.io/labinsight/` 주소는 GitHub Pages에서 `main /docs`로 게시 폴더를 전환해야** 검사 입력 화면이 더 이상 정적으로 공개되지 않습니다. 설정 후 해당 주소는 승인제 Worker 안내만 제공합니다. LabInsight 설정: https://github.com/Haru-today/labinsight/settings/pages

기존 Caffeine Atlas 학회 포스터 QR 및 `https://haru-today.github.io/caffeine-atlas/` 공개 이용은 유지합니다. GitHub Pages는 서버 인증을 수행하지 못하므로 공개 저장소 코드의 변경만으로 운영자 승인제가 적용되었다고 주장하지 않습니다.
