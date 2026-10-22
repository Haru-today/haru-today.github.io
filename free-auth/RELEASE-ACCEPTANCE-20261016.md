# LABDAM·LabInsight 회원 승인제 실사용 보안 검증 — 2026-10-16 (KST)

> **최신 검증·릴리스 기록**. 기존 `REVIEW-20261016.md`는 배포 이전 로컬 검토 시점의 기록이므로 현재 운영 상태로 인용하지 않습니다.
> 대상은 **무료 Cloudflare 시험 Worker** `labdam-free-approval`이며, 정식 의료 서비스의 개인정보 처리/법률 승인을 의미하지 않습니다.

## 릴리스 식별

- Worker: `https://labdam-free-approval.jleegenomics.workers.dev`
- `GET /healthz`: `200`, `readiness=bindings-present`, `release=labdam-auth-20261016-r3-carepath29`
- 검증된 인증 Worker 소스: `86f1bc5cd7ac4ed45ebba50fbe58b4b8d4ff5c97`
- 검증된 LabInsight/CarePath 소스: `5ed1b25a24ca0718d23483606c4961037172edac`
- [실제 Worker 수동 배포 Actions #38885989563](https://github.com/Haru-today/haru-today.github.io/actions/runs/38885989563): **success**. 2026-10-16 19:15 KST 실행.
- [검증 이슈 #23](https://github.com/Haru-today/haru-today.github.io/issues/23): 현장 실계정 시험 단계별 근거를 별도 기록.

## 확인된 보안·운영 경계

| 요구사항 | 근거 | 결과 |
| --- | --- | --- |
| 관리자 실제 Google 인증, 관리자 화면 표시 | 사용자 직접 현장 확인 | ✅ |
| 별도 Google 일반 회원 신규 신청 후 pending 안내 | 사용자 직접 현장 확인 | ✅ |
| 승인 전 CarePath HTML·JS 접근 차단 | 사용자 직접 현장 확인 | ✅ |
| 관리자 승인 후 일반 회원 CarePath 접근 | 사용자 직접 현장 확인 | ✅ |
| approved → pending 철회 시 기존 로그인 세션 차단 | 사용자 직접 현장 확인 | ✅ |
| 재승인 시 기존 로그인 세션 재사용 차단 | 사용자 직접 현장 확인 | ✅ |
| 새 Google 로그인 이후 회원 접근 복구 | 사용자 직접 현장 확인 | ✅ |
| Worker r3 릴리스 식별자, 원격 D1 **스키마만** 조회 | Actions #38885989563 | ✅ |
| 익명 CarePath HTML 303 / JS 401, 관리자 API 401 | Actions #38885989563 익명 GET | ✅ |
| 기존 Caffeine Atlas 공개 루트·분석기·개인정보·약관 200 | Actions #38885989563 익명 GET | ✅ |
| 여러 일반 회원 브라우저의 모든 세션 철회, 재승인 후 복원 방지 | 로컬 workerd + D1 합성 세션 통합 테스트 | ✅ (원격 별도 미확인) |
| 일반 회원이 관리자 UI·API를 사용할 수 없음 | 로컬 workerd + D1 합성 계정 테스트 | ✅ (실계정 별도 미확인) |

현장 성공은 **사용자가 시험 브라우저에서 직접 보고한 결과**이며, ChatGPT가 회원 행·인증 쿠키·실제 Google ID 토큰을 수집하거나 서버 관리자 API를 대신 호출한 결과가 아닙니다. `healthz` 및 비로그인 HTTP 상태만으로 실계정 인증 성공을 주장하지 않습니다.

## 미완료 검증과 출시 전 필수 작업

1. 실계정 일반 회원이 `/admin.html`에 접근하면 403인지, 관리자 데이터 API가 차단되는지 별도 현장 확인.
2. 계정 전환·로그아웃·회원 탈퇴 시 브라우저의 **LabInsight 최신 리포트와 CarePath 세션 기록**이 삭제되는지 실제 단말 확인. 다른 창/장치의 이미 표시된 화면, 내려받은 PDF 및 과거 오프라인 사본은 서버가 원격 회수할 수 없습니다.
3. 실제 건강검진 수치 대신 **합성 값**만 사용해 CarePath 기록 입력·추세·단위 충돌·동일 날짜 비교 보류·삭제가 보호된 Worker에서 정상인지 사용자 브라우저로 확인.
4. 회원 개인정보 운영주체 실명, 전용 비공개 문의 방법, 회원정보 보관 기간, 국외 처리/위탁 관련 고지를 실제 운영 정책에 맞게 확정. `membership-privacy.html`은 **현재 최종 정책이 아닌 안내**라고 표시되어 있습니다.
5. Free Worker/D1 쿼터 및 로그 보유/모니터링, 스키마 백업·복구와 운영자 계정 회복 절차를 확인. 실사용 확대 전 이용자 지원·장애 대응 계획 필요.
6. 공개 GitHub Pages 주소에서는 서비스 안내만 제공하고 앱 파일 직접 접근 경로를 우회할 수 없도록 지속 감사. Caffeine Atlas의 학회 포스터 QR URL은 공개 상태 유지 및 별도 기기 실스캔 검증.

## 향후 변경의 필수 절차

- Worker 변경은 별도 브랜치/PR → Node·로컬 workerd+D1·Chromium 검사 → 승인된 **immutable commit SHA**를 수동 시험 배포 워크플로에 고정 → 테스트 계정 확인 → 배포 직후 익명 권한 감사 순서로 진행합니다.
- `main`에 인증 원본을 무심코 합치면 정적 Pages 자산이 의도치 않게 공개될 위험이 있으므로 **PR #9는 정적 배포 정책 검수까지 Draft**로 유지합니다.
- 다른 Google 계정의 시험은 명시적으로 허용된 시험 계정에 한정합니다. 비밀키·토큰·코드·건강검진 결과·D1 회원 행을 채팅, GitHub 이슈 또는 Actions 로그에 기록하지 않습니다.
- 새로운 유료 옵션, 건강정보 Cloudflare D1 저장, Caffeine Atlas 접근 제한 및 기존 QR URL 변경은 이 보안 검증으로 승인된 작업이 아닙니다.

## 변경을 별도 분류해야 하는 이유

**시험 Worker 접근 제어 동작 확인**과 **실제 의료 개인정보 서비스를 일반 공개할 수 있는지에 대한 검토**는 별개의 결정입니다. 회원 승인 시스템의 실계정 세션 검증은 끝났지만, 개인정보 운영 정책·기기 내 데이터 삭제·추가 권한·운영 통제는 계속 검수합니다.
