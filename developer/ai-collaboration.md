# Codex · Claude Code · Google Antigravity 협업

세 도구는 같은 GitHub 저장소를 공유하고 각자 별도 브랜치/작업 폴더에서 일합니다.
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

4. 새 폴더에서 도구를 실행합니다. 한 폴더는 한 도구만 수정합니다. 같은 파일을
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
