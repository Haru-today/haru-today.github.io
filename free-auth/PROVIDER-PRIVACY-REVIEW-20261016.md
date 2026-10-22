# LABDAM·LabInsight — Google OAuth / Cloudflare D1 개인정보 제공자 점검

**작성:** 2026-10-16 · **상태:** 운영자 현장 확인 필요 · 법적 분류 미확정 · 배포·DB 조회 없음

이 문서는 회원 승인제 로그인에서 이용 중인 외부 서비스를 개인정보 처리방침과 실제 계정 설정에 맞게 검증하는 업무용 검토표입니다. 사업자·제공자 계약이나 국외 이전의 법적 분류를 임의로 확정하지 않습니다.

## A. 서비스 정보 흐름 (현행 소스 기준)

| 구성 | 서버로 전달하는/저장하는 데이터 | 현재 확인 근거 |
|---|---|---|
| Google OpenID Connect | `openid email profile` 요청, Google subject, 검증된 이메일, 표시 이름으로 회원 식별 | `free-auth/worker.mjs`의 OAuth 요청·ID 토큰 확인과 `members` 생성 로직 |
| Cloudflare Worker | 승인 여부 확인·로그인 세션 쿠키 확인; OAuth code/token 교환을 서버에서 처리 | `free-auth/worker.mjs` |
| Cloudflare D1 | 회원 subject·이메일·표시 이름·선택 가입 목적·승인 상태·심사자 식별자·시각, 세션 해시/CSRF 및 OAuth 상태, 남용 제한 해시 | `free-auth/migrations/0001_initial.sql` |
| LabInsight / CarePath 브라우저 | 검사 결과·날짜별 수치가 브라우저 탭의 임시 저장소에 남을 수 있음 | LabInsight `app.js` 및 `carepath-data.js` |
| Caffeine Atlas | 별도의 공개 서비스. 회원 승인 DB와 통합하지 않음 | 별도 서비스 범위로 개인정보 안내 검토 필요 |

**금지:** 실계정 토큰, 실제 건강 결과, D1 회원 행, 비밀키를 검토 문서나 GitHub 이슈에 붙이지 않습니다.

## B. Cloudflare — 운영자 계정에서 확인할 내용

- [ ] **D1 데이터베이스 `labdam-membership`의 메타데이터:** 계정 Dashboard > D1 > 해당 데이터베이스 > Data location 항목을 확인합니다. 실제 생성 시점의 *jurisdiction* 또는 *location hint*, 주 데이터 저장 지역 및 복제 설정은 계정에서 직접 확인해야 합니다.
- [ ] Cloudflare의 D1 **jurisdiction은 생성 후 변경할 수 없고**, location hint는 희망 지역에 대한 힌트이지 저장 위치 보증이 아닙니다. 현재 DB에 어떤 값이 설정됐는지 코드의 D1 UUID만으로 판단하지 않습니다.
- [ ] D1 읽기 복제 사용 여부, 로그와 백업 복구 시 보존 범위, Cloudflare 계정의 DPA 및 Subprocessor 정보, 실제 사용자 요청에서 개인정보가 어느 서비스와 처리 경로를 거치는지 검토.
- [ ] 계약 및 적용 법령을 근거로 D1·Workers 활용이 처리위탁·제3자 제공·국외 이전 중 어디에 해당하는지, 고지 사항(정보 항목·국가·시점·방법·보유기간·권리 행사 등)을 검토.
- [ ] 근거가 없는 '한국 서버에서만 처리', '국외 이전 없음', '전 세계 복제 없음' 같은 문구를 회원가입 안내나 정식 처리방침에 쓰지 않습니다.
- [ ] 개인정보 정책 확정과 관계없이 유료 요금제·새 DB·새 데이터 저장지역을 임의로 설정하지 않습니다.

**공식 확인 자료**
- [Cloudflare D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/) (2026-04-21 업데이트)
- [Cloudflare D1 data security](https://developers.cloudflare.com/d1/reference/data-security/) (전송 및 저장 암호화)
- [Cloudflare D1 API metadata](https://developers.cloudflare.com/api/resources/d1/) (DB jurisdiction 및 read_replication 구성)
- Cloudflare Dashboard > 계정 데이터 처리약관(DPA) 및 외부 위탁/협력업체 목록은 계정·적용 버전을 직접 확인.

## C. Google OAuth — 운영자 계정에서 확인할 내용

- [ ] Google Cloud Console > Google Auth Platform > **Branding**에서 LABDAM 서비스 정식 표시명 및 정확한 운영 주체(개인 또는 사업자)를 확인.
- [ ] Google OAuth **Authorized domains**, 홈페이지, 공개 접속 가능한 개인정보처리방침 URL과 실제 안내 문구 일치 확인. 회원가입 전 `/membership-privacy.html` 안내 링크도 유지.
- [ ] 실제 요청 범위를 `openid email profile`로 확인하고, 미사용 Drive/Gmail/Calendar 등 **추가 Google API 접근 권한은 요청하지 않는지** 검토.
- [ ] 테스트/프로덕션의 사용자 유형, 동의 화면 상태, Google 인증/브랜드 검증 필요 여부를 현재 프로젝트 콘솔에서 직접 확인. 인증 성공만으로 정식 브랜드 검증 완료라고 단정하지 않음.
- [ ] Google OAuth 수집항목·사용 목적·탈퇴 후 삭제 방식과 공개 개인정보처리방침의 문구를 일치시키고, 변경 시 적절히 이용자에게 고지.

**공식 확인 자료**
- [Google OAuth 2.0 policies](https://developers.google.com/identity/protocols/oauth2/policies) (2026-08-05 수정)
- [Google Sign-In 브랜드 검증 안내](https://developers.google.com/identity/verification/authentication-policy-compliance)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)

## D. 근거 확보 및 승인 단계

1. 공개 GitHub Issue #24에는 '확인됨/미확인' **상태와 링크만 기록**. 사용자 메일 주소, 서비스 계정 ID/비밀키, 스크린샷의 개인 항목은 올리지 않습니다.
2. 운영자가 법적 개인정보처리자(실제 운영 주체명)·실제 비공개 문의처·구체적 회원 보유기간 및 외부 처리 검토를 최종 승인합니다.
3. 그 결정에 부합하도록 회원 처리방침 본문과 Worker 회원 보유/삭제 코드·테스트를 별도로 수정합니다.
4. `node free-auth/scripts/preflight-static.mjs --require-real-d1 --require-final-policy` 검사를 마지막 단계에 실행합니다. **이 검사가 통과해도 법률 적합성을 인증하는 것은 아닙니다.**
5. 수동 시험 Worker 배포 승인과 배포 후 로그인/권한/비밀정보 비노출 검증은 별도. 공개 Caffeine Atlas URL·기존 포스터 QR 유지.

**현재 결론:** Google 및 Cloudflare를 사용한다는 사실 외에, 실제 D1 데이터 위치·국외 처리 분류·위탁계약 확인·운영 주체 및 연락처는 아직 문서상 최종 확인되지 않았습니다.
