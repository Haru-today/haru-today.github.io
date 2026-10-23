# Codex · Claude Code · Google Antigravity 협업

세 도구는 같은 GitHub 저장소를 공유합니다. 동시 작업은 별도 브랜치/작업 폴더에서
진행하고, 순차적으로 이어할 때는 이전 도구가 수정을 끝낸 작업 폴더를 재사용할 수 있습니다.
대화·로그인·구독은 도구별이며 자동으로 서로 공유되지 않습니다. 공통 작업 규칙은
각 저장소의 `AGENTS.md`이고 `CLAUDE.md`, `GEMINI.md`가 이를 가져옵니다.

## 시작과 인계

1. 해당 저장소에서 `git status --short --branch`와 원격 저장소를 확인합니다.
2. `git fetch origin`으로 원격 이력을 가져옵니다. 로컬 파일을 갱신하지는 않습니다.
3. 새 작업은 아래와 같이 브랜치와 폴더를 나눕니다. `task-name`은 실제 작업명으로,
   `claude`는 `codex`, `claude`, `gemini` 중 담당 도구명으로 바꿉니다.

   ```sh
   git worktree add -b claude/task-name ../task-name-claude origin/main
   ```

4. 새 폴더에서 도구를 실행합니다. 한 시점에는 한 도구만 수정합니다. 같은 파일을
   병렬 수정해야 한다면 먼저 작업 범위를 나누고 통합 담당자를 정합니다.
5. 변경 파일을 이름으로 지정해 stage하고 diff/검사를 확인한 뒤 task branch에
   커밋·푸시합니다. PR 본문에 변경 이유, 실행한 검사, 남은 제한을 기록합니다.
6. 다른 PC에서는 fetch 후 해당 branch를 별도 worktree로 열거나, 이미 사용하는
   branch가 깨끗하고 분기되지 않았을 때만 `git merge --ff-only origin/BRANCH`로
   갱신합니다. 실패하면 멈추고 이력을 확인합니다. reset/force push로 해결하지 않습니다.

GitHub가 공유하는 것은 커밋입니다. 미커밋 파일·실험 원본·인증정보·AI 대화·D1은
동기화 대상이 아닙니다. 같은 브랜치를 두 PC에서 동시에 수정하지 마세요.

## 도구 설치와 로그인

- Codex는 기존 ChatGPT 로그인과 모델 설정을 사용합니다. 지원되는 모델/추론 수준은
  도구의 `/model`에서 확인합니다. 설정을 파일에 넣는 것만으로 현재 대화 모델이
  바뀌었다고 간주하지 않습니다.
- Claude Code는 공식 설치 후 `claude auth login --claudeai`로 기존 Claude 구독에
  로그인합니다. Console/API billing을 선택하지 않습니다.
- Google AI Pro/Ultra는 Antigravity CLI `agy`를 실행해 개인 Google 계정으로
  로그인합니다. 기존 Gemini CLI의 개인 구독 요청 지원은 2026-06-18 종료됐습니다.
  `AGENTS.md`와 `GEMINI.md`는 Antigravity에서도 지원합니다. 추가 AI 크레딧/초과
  사용을 활성화하지 말고 기존 구독 한도만 사용합니다.
- 사용자 로그인·계정 선택·동의는 직접 완료합니다. 비밀번호, OAuth 코드, 토큰을
  채팅이나 저장소에 붙여 넣지 않습니다. 구독 한도 초과 시 API로 자동 전환하지 않습니다.
- 기본 승인/신뢰 확인을 유지합니다. `--yolo`, `--dangerously-skip-permissions`나
  무제한 자동 실행을 사용하지 않습니다. API 환경변수가 있는 셸은 사용 전에 확인합니다.

공식 안내: [Codex 모델 선택](https://learn.chatgpt.com/docs/developer-commands#set-the-active-model-with-model),
[Claude 설치](https://code.claude.com/docs/en/setup),
[Claude 구독 로그인](https://code.claude.com/docs/en/authentication),
[Google CLI 전환 안내](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/),
[Antigravity 설치](https://www.antigravity.google/docs/getting-started/),
[로그인](https://www.antigravity.google/docs/install?tab=cli),
[규칙 호환](https://www.antigravity.google/docs/cli/gcli-migration/).

## Mac과 Windows

`setup-macos.sh` 또는 `setup-windows.ps1`에 원하는 작업 루트를 전달하세요.
기존 저장소는 보존하며 origin이 다른 폴더에서는 중단합니다. 비공개 저장소를
복제하려면 해당 PC에서도 먼저 GitHub 로그인이 필요합니다. 토큰을 URL에 넣지 마세요.
도구와 Node/Git 설치, 계정 로그인은 각 PC에서 별도로 확인합니다.

Windows에서 `git`, `node`, `gh`의 설치·로그인을 확인한 후:

```powershell
gh auth status
.\developer\setup-windows.ps1 -Root (Join-Path $env:USERPROFILE 'Documents\LABDAM-Workspace')
```

Mac/Windows CI는 임시 저장소로 보존 동작을 검증합니다. CI 성공은 사용자의 실제
Windows PC 설정이나 구독 로그인이 끝났다는 뜻이 아닙니다. PR 절차와 서버의
강제 브랜치 보호도 별개입니다. 계정 기능이 부족해도 공개 전환/유료 업그레이드는
독단적으로 진행하지 않습니다.

## 인증 Worker와 배포

운영 소스는 수동 release workflow의 인증/app commit SHA를 기준으로 확인합니다.
일반 작업에서 `main` 갱신이나 PR 생성은 배포 요청이 아닙니다. Worker, D1, OAuth,
관리자 승인, 읽기 전용 source deploy key와 기존 배포 pin을 보존합니다. auth 원본을
검토하려면 정확한 SHA의 별도 detached worktree를 사용하고, 원격 D1 데이터는 읽지
않습니다. 배포·병합은 소유자의 별도 승인과 해당 workflow 검증을 따릅니다.

## 같은 프로젝트를 다른 AI에서 이어하기

### 같은 Mac에서 순서대로 이어할 때

이전 도구의 파일 수정이 끝났는지 확인한 뒤 **같은 프로젝트 폴더와 같은 작업
브랜치**에서 Claude Code 또는 Antigravity를 실행해도 됩니다. 한 폴더에 동시에
두 명의 작성자가 들어가지 않는 원칙은 그대로 유지합니다.

1. 현재 도구가 아래 인계 형식으로 목적, 바뀐 파일, 실행한 검사, 다음 작업을 기록합니다.
2. 다음 도구가 저장소의 `AGENTS.md`, 관련 소스, 그 인계 문서를 먼저 읽습니다.
3. `git status --short --branch`와 마지막 코드 커밋을 확인하고 기존 수정 내용을
   보존한 상태에서 이어갑니다. 미커밋 변경을 다른 도구가 만든 오류로 단정하지 않습니다.
4. 다른 AI의 대화가 자동으로 보이는 것으로 가정하지 않습니다. 필요한 결정과
   요구사항은 저장소 인계 문서에 적습니다. 비공개 앱 내용은 그 비공개 저장소에 남깁니다.

### 동시에 작업하거나 다른 PC에서 이어할 때

동시 작업은 별도 worktree와 브랜치를 사용합니다. **진행 중인 작업을 이어받는
출발점은 그 작업의 원격 브랜치/검토된 코드 커밋**입니다. 새 작업을 시작할 때와
달리 무조건 `origin/main`에서 시작하면 아직 병합하지 않은 변경이 빠집니다.

다른 PC에서는 먼저 이전 PC의 의도한 변경을 커밋·푸시한 뒤, 원격 브랜치의
커밋과 인계 문서를 확인합니다. 로컬 수정이나 분기된 이력이 있으면 기존 작업을
보존하고 별도 폴더에서 비교합니다.

### 인계 문서

[인계 양식](handoff-template.md)을 복사해 이 포털 저장소에서는
`developer/handoffs/<task-name>.md`에 저장합니다. 비공개 앱은 해당 저장소의
기존 인계 문서 경로를 사용합니다. 현재 협업 구성은
[실제 작업 인계](handoffs/ai-collaboration-20261023.md)에 기록합니다.

각 작업 브랜치에서 인계 문서를 갱신하고, 같은 작업을 이어가는 도구는 새 계획을
만들기 전에 읽습니다. 임시 설치 경로, 계정 정보, 대화 전문 대신 재현 가능한
작업 상태를 남깁니다. 인계 문서가 최종 코드보다 오래됐으면 소스와 Git 이력을
기준으로 정정합니다.

Claude 웹의 '프로젝트'는 기획·설명·검토 문맥을 정리하는 용도로 사용할 수 있습니다.
GitHub 연동으로 넣은 파일은 최신화 상태를 확인해야 합니다. 실제 파일 편집과
검사 실행을 이어가려면 해당 코드 폴더를 여는 Claude Code를 사용합니다.

## Codex에서 외부 AI에 검토를 맡길 때

프로젝트 이어하기와 외부 AI 호출은 따로 검증합니다. 현재 이 PR은 공통 지침,
인계 절차와 연결 점검 도구를 제공합니다. **사용자 기기에서 자동 검토 호출·응답
수신이 검증됐다는 뜻은 아닙니다.**

권장 작업 흐름은 다음과 같습니다.

1. Codex가 검토할 작업 브랜치, 코드 커밋, 특정 변경 파일과 질문을 정리합니다.
2. 사용자 기기에서 구독으로 인증된 Claude Code 또는 Antigravity를 통해
   해당 범위의 검토를 요청합니다. 서비스에 보낼 수 없는 데이터는 포함하지 않습니다.
3. 도구의 종료 상태와 실제 응답을 확인합니다. 로그인·한도·네트워크 실패를
   검토 완료로 처리하거나 다른 유료 인증 방식으로 자동 전환하지 않습니다.
4. Codex가 지적 사항을 원본 코드와 대조하고 적용 여부를 판단합니다.
   외부 AI의 답변은 검토 의견이며 그대로 자동 병합하는 지시가 아닙니다.
5. 반영한 수정은 관련 검사로 확인하고, 검토 제공자·대상 커밋·반영/보류 이유를
   인계 문서 또는 PR에 기록합니다.

Claude Code는 `claude -p`, Antigravity는 `agy -p`로 비대화형 응답을 받을 수
있습니다. 하지만 명령의 존재만으로 현재 기기의 로그인이나 읽기 전용 실행이
검증되는 것은 아닙니다. 특히 Antigravity 헤드리스 모드는 활성 작업 폴더 내부의
파일 쓰기를 기본 허용하므로, 프롬프트에 '읽기 전용'이라고 쓰는 것만으로
권한 제한이 완성됐다고 간주하지 않습니다. 실행 버전과 권한 제한을 확인한 다음
자동 검토 연결을 구현합니다. 전역 승인 우회 설정을 켜서 해결하지 않습니다.

최초 연결 검증에서는 민감정보 없는 짧은 확인 요청의 실제 응답을 먼저 확인하고,
그다음 지정한 코드 변경을 검토하게 합니다. 설치, 로그인, 짧은 요청 성공,
코드 검토 성공을 각각 기록합니다. 이 세션에서 검증하지 못한 것은 '확인 필요'로
남기고, 사용자 기기 연결이 필요하면 그 단계만 명확히 인계합니다.

공식 근거:
[Claude Code 비대화형 실행](https://code.claude.com/docs/en/headless),
[Claude Code 로그인](https://code.claude.com/docs/en/authentication),
[Antigravity 비대화형 실행과 권한](https://www.antigravity.google/docs/cli/headless/),
[Claude 프로젝트의 GitHub 연결](https://support.claude.com/en/articles/10167454-use-the-github-integration).

## 사용자 기기에서 연결 점검

`developer/ai-doctor.mjs`는 추가 패키지 없이 Node로 실행합니다. 현재 작업
브랜치를 안전하게 갱신한 뒤 포털 저장소 루트에서 실행하세요. 이 파일이 아직
`main`에 없다면 기존 협업 PR의 브랜치를 사용합니다. 로컬 수정이 있으면 먼저
상태를 확인하고, 현재 작업을 덮어쓰는 checkout/reset을 하지 않습니다.

```sh
node developer/ai-doctor.mjs
```

기본 실행은 Git 작업 상태와 `claude`, `agy`의 설치·버전·도움말을 확인합니다.
AI에 응답을 요청하지 않습니다. 결과는 JSON이며 계정 이메일, 토큰, 환경변수 값,
원본 인증 응답과 원본 오류 출력을 보고서에 넣지 않습니다. 명령이 `0`으로 끝나도
모든 CLI가 설치됐거나 로그인됐다는 뜻은 아닙니다. 각 항목의 상태를 읽습니다.

Claude에 실제 확인 요청을 보내려면 다음을 실행합니다.

```sh
node developer/ai-doctor.mjs --probe-claude
```

이 실행은 API/다른 공급자 인증 환경설정을 확인하고, 지원 옵션 및 기존
`claude.ai` 인증을 확인한 다음 프로젝트 밖 임시 디렉터리에서 무작위 확인
문구만 요청합니다. 프로젝트 코드를 요청에 넣지 않습니다. 내장 도구와 MCP를
끄는 옵션을 함께 전달하며, JSON 응답의 성공 상태와 확인 문구의 정확한 일치가
모두 확인되어야 `claudeProbe.state`가 `passed`가 됩니다. 인증 실패·알 수 없는
인증 경로·지원 여부를 확인하지 못한 옵션·응답 불일치에서는 성공으로 처리하지
않으며, 제한 옵션을 제거하거나 API 인증으로 바꿔 재시도하지 않습니다.

기존 구독 사용량은 소비될 수 있습니다. 점검 도구는 추가 사용 과금이나 구독
설정을 변경하지 않으며, 계정의 잔여량이나 추가 과금 여부를 보증하지 않습니다.
`--safe-mode`에도 조직의 관리 정책은 적용될 수 있으므로 이 실행을 운영체제
샌드박스나 모든 정책 실행의 차단으로 설명하지 않습니다. 지원 옵션은
[Claude CLI 공식 문서](https://code.claude.com/docs/en/cli-reference)를 기준으로
하되 실제 설치본에서 확인합니다. `--safe-mode`와 `--restricted`는 도움말에
숨겨질 수 있어 공식 도입 버전을 함께 사용합니다. Claude Code 2.1.248 이상은
두 옵션을 지원하는 버전 근거가 있습니다. 나머지 필수 옵션의 지원 여부를 확인하지
못하면 중단합니다. 옵션 오류가 나도 제한을 제거해 재시도하지 않습니다.
버전 근거: [safe mode 도입](https://code.claude.com/docs/en/whats-new/2026-w24),
[restricted 및 실행 옵션](https://code.claude.com/docs/en/cli-reference).

| 결과 | 해석 |
| --- | --- |
| 기본 실행 종료 코드 `0` | 진단 보고서를 만들었음; 개별 설치 상태는 JSON 확인 |
| `claudeProbe.state: not_requested` | 실제 Claude 요청을 실행하지 않았음 |
| `claudeProbe.state: passed` | 해당 기기·인증 경로에서 짧은 Claude 응답을 검증했음 |
| `claudeProbe.state: blocked` 또는 `failed` / 종료 코드 `1` | 요청 전 조건 미충족 또는 실제 호출 실패; `reason` 확인 |
| 종료 코드 `2` | 사용법 오류 또는 진단 자체의 오류 |
| Google 인증·응답 / `codeReview` | 아직 미검증·미실행; Claude 확인 요청 성공과 별개 |

Google `agy`는 이 도구에서 설치·버전·도움말까지만 확인합니다. 검증된 실행별
권한 제한을 확인하기 전에는 모델 요청을 자동 실행하지 않습니다. 도움말로
확인하지 않은 인증 명령을 추정해 호출하거나 전역 설정을 바꾸지 않습니다.

개발 검사는 `node --test tests/ai-doctor.test.cjs`로 실행합니다. 모의 CLI를
사용하므로 실제 계정 로그인이나 외부 모델 응답을 검증한 결과로 보고하지 않습니다.

### 로컬 Work에서 이어받기

사용자 Mac의 설치와 구독 세션을 확인하려면 그 Mac의 폴더와 터미널에 접근할 수
있는 Work 작업이 필요합니다. 현재 작업이 클라우드에서만 실행되면 대화 동기화나
GitHub 연결만으로 Mac의 파일·CLI·로그인 세션이 연결되지는 않습니다.

Mac의 기존 LABDAM 프로젝트에서 로컬 컴퓨터 접근이 가능한 Work 작업을 열고
이 [작업 인계](handoffs/ai-collaboration-20261023.md)를 먼저 읽습니다. 기존
클라우드 작업에서 로컬 접근을 사용할 수 없으면 같은 프로젝트에서 로컬 작업을
시작해 이 인계를 이어받습니다. 실제 저장소 경로와 미커밋 변경을 확인한 뒤 위
진단과 요청 검사를 진행하고, 그 결과를 바탕으로 지정 코드의 검토 호출을 구현합니다.

Work 안내: [기기 간 이어하기와 로컬 접근](https://learn.chatgpt.com/docs/get-started-with-work),
[프로젝트 폴더 연결](https://learn.chatgpt.com/docs/projects#use-local-projects-for-folders-and-codebases).
