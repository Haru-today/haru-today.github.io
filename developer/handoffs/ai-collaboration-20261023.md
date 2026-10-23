# LABDAM AI 협업 환경 구성 — 작업 인계

갱신일: 2026-10-23. 사용자 Mac에서 확인한 상태이며 시각은 KST(UTC+9) 기준입니다.

## 목적과 이어받을 코드

Codex가 지정한 코드만 Claude 또는 Google AI에 검토 요청하고, 응답을 원본과
대조해 필요한 수정을 반영하는 흐름을 구성합니다. 대화 전문의 자동 동기화와
GitHub를 통한 코드·인계 공유는 구분합니다.

- 저장소: `Haru-today/haru-today.github.io`
- 작업 브랜치: `chore/ai-collaboration-20261023`
- 시작한 원격 코드 커밋: `7d53ddbd55484f55fd822b57bbff8be7f5e3a5ac`
- 기존 초안: [PR #48](https://github.com/Haru-today/haru-today.github.io/pull/48)
- 이번 수정은 위 커밋 이후의 변경입니다. 다시 이어받을 때
  최신 PR HEAD·현재 브랜치·미커밋 변경을 비교하세요. 새 저장소나 중복 PR을
  만들지 않으며, 이 작업에서 병합·배포는 하지 않았습니다.

## 현재 구현과 확인 상태

| 항목 | 확인한 상태 |
| --- | --- |
| 공통 규칙과 인계 | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` 및 인계 양식 유지 |
| 작업공간 설정 | 기존 파일 보존·origin 확인·worktree 인식 유지 |
| `developer/ai-doctor.mjs` | 로컬 진단과 명시적 Claude 응답 검사 구현; 사용자 Mac 실제 응답 성공 |
| `developer/ai-review.mjs` | 지정 snapshot·manifest 작성, 명시적 전송, 응답 검증·수집 구현 |
| Claude 코드 검토 | 실제 응답 수집 후 findings 3개를 코드와 대조하고 수정 |
| `developer/ai-google.mjs` | macOS 원본·설정 격리, 실효 권한 확인 및 실제 응답·코드 검토 성공 |
| 로컬 개발 검사 | 아래 4개 검사 파일의 68개 검사 모두 통과 |
| GitHub CI | 최신 수정 커밋의 원격 CI 결과는 별도 확인 필요 |
| 실제 Windows PC | 이번 Mac 확인으로 설정·인증 완료를 주장하지 않음 |

기존 Mac 세 프로젝트의 HEAD·Git 상태·diff 기준선이 유지됨을 확인했습니다.
원본의 미커밋 작업을 reset·clean·stash·덮어쓰기하지 않았습니다. 이 기준선
점검을 모든 미추적 파일의 내용까지 검증한 것으로 확대하지 않습니다.
Workers/D1/Google OAuth/관리자 승인과 배포 pin을 유지합니다. 계정 정보,
인증값, 개인 경로, 원본 대화 및 비공개 앱 소스는 공개 인계에 포함하지 않습니다.

## 실제 Claude 요청의 증거와 범위

- 연결 검사: 2026-10-23 22:12 KST(13:12 UTC), doctor 실제 응답 검사 통과.
- 코드 검토: 2026-10-23 22:20:25–22:21:23 KST(13:20:25–13:21:23 UTC).
- 도구: Claude Code `2.1.309`, 기존 `claude.ai`의 `pro` 구독 경로.
- 응답에 보고된 모델: `claude-opus-5-5`.
- 결과: `state: completed`, `reason: review_validated`,
  `requestAttempted: true`, 종료 코드 `0`.
- 인증 조건 보완 후 22:26:39–22:26:43 KST에 별도 합성 응답 검사도 성공했습니다.
- 전송 범위는 아래 두 파일의 당시 작업트리 snapshot뿐입니다. 기반 HEAD는
  위의 `7d53ddbd...`이며, 미커밋 수정이 포함되어 파일 해시도 기록합니다.
  이후 수정본 전체를 외부 모델이 재검토했다는 뜻은 아닙니다.

| 실제 검토 파일 | 전송한 바이트의 SHA-256 |
| --- | --- |
| `developer/ai-doctor.mjs` | `bdd29774e1b9ceefb6594abf60f18d9a2d38ebb825146958ae7a294b825c022e` |
| `developer/ai-review.mjs` | `5c982b0dccdeb9ba7c77328874539f2912171e2bbdfd1ae84bbc990809520cd4` |

Payload SHA-256:
`ca5500d289559e75fc338581343d54de4cf0b0ad9645bcdbcde8ab61bf7ad129`.

호출 전후 `reviewedSourceUnchanged: true`를 확인했습니다. 범위는
`selected_file_bytes_and_git_metadata`이며, 지정하지 않은 기존 미추적 파일의
내용까지 같다는 보증은 아닙니다. 원본 응답을 공개 로그로 복사하지 않고 검토
식별자와 필요한 판단 근거만 기록합니다.

## 외부 findings 대조와 반영

| 항목 | 코드 대조 및 반영 | 검증 근거 |
| --- | --- | --- |
| F1: 로그인 여부 누락을 성공으로 분류 | `loggedIn === true` 및 확인된 개인 `pro`/`max` 구독을 요구. 필드 누락·불명확한 구독은 차단 | doctor의 누락·형식 오류·구독 종류 회귀 검사 |
| F2: 비밀값 형태 탐지 누락 | AWS, Slack, Stripe, npm, JWT 형태 탐지 추가 | review의 합성 비밀값 전송 차단 검사 |
| F3: 마지막 개행으로 줄 수가 1 증가 | 마지막 개행과 빈 파일의 줄 수를 구분해 존재하지 않는 줄의 finding을 거부 | review의 줄 수·빈 파일 좌표 검사 |

F1의 추가 제안 중 `apiProvider` 필드 자체를 필수로 만들지는 않았습니다.
명시적 로그인과 개인 구독 확인에 더해 API 키 출처나 명시된 비공식 provider는
차단합니다. provider가 생략되거나 `firstParty`인 지원 응답은 회귀 검사로
구분합니다. 비밀값 형태 검사는 알려진 패턴의 보조 검사이며, 민감 자료를
전송해도 된다는 보증이 아닙니다. 전송할 파일을 먼저 확인해야 합니다.

내부 코드 검토에서도 다음을 반영했습니다. Claude의 추가 findings로 기록하지 않습니다.

- JSON Unicode escape로 숨겨진 비밀값도 파싱 후 모든 응답 문구에서 검사.
- provider 예외 또는 잘못된 반환값으로 실제 호출 여부를 알 수 없으면 `failed`와
  `requestAttempted: null`을 기록하고 미호출로 단정하지 않음.
- 결과 파일 저장 실패가 이미 실행된 요청·검토 결과를 지우지 않도록 이력 보존.
- 보존 상태를 지정 파일 바이트와 Git 메타데이터 범위로 명시.
- Google 런타임의 인증·로그 쓰기를 허용하되 hooks/MCP/plugins/agents/skills/rules
  등 실행 설정 경로는 별도로 읽기·쓰기 차단.

## 로컬 검사와 실제 호출의 구분

사용자 Mac의 현재 수정본에서 다음 명령을 실행해 68/68 통과했습니다.

```sh
node --test tests/workspace-bootstrap.test.cjs tests/ai-doctor.test.cjs tests/ai-review.test.cjs tests/ai-google.test.cjs
```

| 검사 | 통과 수 | 확인 범위 |
| --- | ---: | --- |
| workspace-bootstrap | 9 | 임시 Git 저장소 생성·재실행·기존 작업 보존 |
| ai-doctor | 22 | 모의 CLI 응답·구독 판정·진단/실패 분류 |
| ai-review | 21 | 지정 snapshot·응답 검증·보존 범위·저장 실패 |
| ai-google | 16 | 모의 Google CLI·실효 권한 판정·OS 정책·실패 경로 |

이 68개 검사는 외부 모델을 호출하지 않습니다. 실제 Claude·Google 연결과
코드 검토의 근거는 별도 호출 결과입니다. 모의 검사 통과와 사용자 Windows PC
설정·인증 완료를 구분합니다.

## 실제 Google 요청의 증거와 범위

기존 Google 계정으로 인증된 Antigravity CLI `agy 1.4.6`을 사용했습니다.
전용 에이전트에도 기본 도구 60개가 노출되어 도구가 없는 것으로 취급하지 않습니다.
실제 검증한 방식은 macOS에서 원본 읽기·쓰기와 일반 프로세스 실행을 차단하고,
임시 폴더·네이티브 인증/로그를 제외한 쓰기를 제한하는 별도 실행입니다.
Keychain과 CLI 인증 런타임은 기존 로그인에 필요한 예외입니다.

- 합성 문구 검사: 22:37:58–22:38:21 KST(13:37:58–13:38:21 UTC), 정확히 일치.
- 실제 코드 검토: 22:45:02–22:46:28 KST(13:45:02–13:46:28 UTC).
- 대상: `developer/ai-review.mjs`의 당시 작업트리 snapshot 하나.
- 파일 SHA-256: `280b280d6a4d57c08645b617a2d5edc46901365f50af8546bdb12692172c4eed`.
- Payload SHA-256: `b0b85b82d318738b170f870c57bf5fb988d2df8f43b6dd9bf6e664f346dd1a3c`.
- 결과: `completed` / `review_validated`, `requestAttempted: true`, 종료 코드 `0`.
- 검토 내용: 인증 경로, 입출력 제한, 결과 판정, 저장소 보존, 비밀값 필터를 확인했고
  `findings: []`를 반환했습니다. 추가 외부 수정 제안은 없으며 무결함 보증은 아닙니다.
- `reviewedSourceUnchanged: true`. 원본 읽기·쓰기, 임시 폴더 밖 쓰기와 일반 실행
  차단의 실제 검사 모두 통과했습니다. 전역·공유·프로젝트 권한 3개 scope에 추가
  허용 규칙이 없고 초기화가 지정 에이전트·임시 경로·`request-review`와 일치했습니다.
- 도구 사용은 관찰되지 않았습니다. 응답에 모델명이 보고되지 않아 추정하지 않습니다.

앞선 두 파일(`ai-google.mjs`, `ai-review.mjs`) 동시 검토는 22:41:20–22:44:20 KST에
3분 제한으로 `failed` / `request_timeout` 처리했습니다. 요청 자체는 실행됐으며
원본 보존은 확인했습니다. 이를 검토 성공으로 세지 않고 대상 파일을 줄여 위의
두 번째 요청을 완료했습니다. Google이 adapter 자체까지 검토한 것으로 확대하지 않습니다.

API 키 경로, 추가 크레딧 활성화와 전역 승인 우회는 사용하지 않았습니다. 기존
계정 설정을 변경하지 않으며, Google 네이티브 계정 내 대화·로그 저장은 남을 수
있습니다. 이 검토 방식은 검증한 macOS·CLI 버전에 한정됩니다.

## 다음 작업과 이어받기

1. 현재 브랜치·PR HEAD·미커밋 변경과 파일 소유자를 확인합니다. 이전 작성자의
   수정이 끝난 뒤 이어받고, 동시에 작업할 때는 worktree를 분리합니다.
2. `developer/ai-collaboration.md`의 연결 점검·코드 검토 사용법을 따릅니다.
   먼저 명시한 파일의 manifest를 확인한 뒤 `--send`로 전송합니다. 응답은 저장소
   밖에 보관하고 필요한 판단·검사 결과만 인계합니다.
3. 원격 CI는 기존 PR #48의 해당 커밋 실행 결과로 확인합니다. 실제 Windows
   기기의 설치·인증은 별도 확인 대상이며 Google 검토 adapter는 macOS 전용입니다.
4. 외부 응답은 제안으로 취급합니다. 파일·줄·근거를 원본과 대조해 반영/보류
   이유를 기록하며, 모델이 제시한 코드나 명령을 자동 적용하지 않습니다.
5. 다른 PC로 이동하기 전 의도한 변경만 커밋·push하고 인계를 갱신합니다.
   미커밋 파일·로그인 세션·AI 대화·D1 데이터는 GitHub로 동기화되지 않습니다.

병합·배포·인증 또는 관리자 승인 설정 변경은 별도 소유자 승인 범위입니다.
기존 사용자 결정과 보안 경계를 유지하고, 계정의 잔여량·추가 과금 여부를
연결 검사 성공만으로 보증하지 않습니다.
