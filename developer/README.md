# LABDAM 통합 개발 작업 공간

이 폴더의 스크립트는 **각 컴퓨터에 이미 있는 코드를 삭제하지 않고** 기존 GitHub 저장소를 별도 폴더로 복제합니다. 이 변경 자체는 서비스 배포를 수정하지 않습니다.

## 저장소 구성

| 로컬 디렉터리 | GitHub |
| --- | --- |
| `LABDAM-Workspace/labdam` | `Haru-today/haru-today.github.io` |
| `LABDAM-Workspace/labinsight` | `Haru-today/labinsight` |
| `LABDAM-Workspace/caffeine-atlas` | `Haru-today/caffeine-atlas` |
| `LABDAM-Workspace/labdam-auth` | 인증 Worker 원본 URL 확인 시에만 선택적으로 복제 |

### macOS

```bash
curl -fL -o /tmp/labdam-setup.sh https://raw.githubusercontent.com/Haru-today/haru-today.github.io/main/developer/setup-macos.sh
bash /tmp/labdam-setup.sh
```

다운로드 실행 전에 스크립트를 열어 검토하세요. 위 주소는 병합된 `main`의 설정 스크립트입니다.

### Windows PowerShell

PowerShell에서 저장소에 있는 `developer/setup-windows.ps1` 파일을 먼저 다운로드하고 내용을 검토한 다음 실행합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-windows.ps1
```

기본 경로는 양쪽 모두 홈 디렉터리 아래 `LABDAM-Workspace`입니다. 다른 위치에 만들려면 Mac은 첫 번째 인자, Windows는 `-Root` 매개변수를 전달합니다.

## Codex · Claude Code · Gemini CLI 사용

공통 규칙은 각 저장소의 `AGENTS.md`이며 도구별 진입 파일이 이를 가져옵니다.
브랜치·worktree·계정 로그인·PC 인계 방법은 [협업 안내](ai-collaboration.md)를 따르세요.

- Windows와 Mac에서 같은 저장소를 각자 clone하고 Codex에서 필요한 하위 폴더를 엽니다.
- 수정 전 `git status`로 작업 내용을 확인합니다.
- 각각의 기능별 브랜치에서 작업하고 PR 검토·테스트 후에만 `main`에 병합합니다.
- 다른 PC로 이동할 때는 먼저 현재 PC에서 커밋·푸시하고, 다른 PC에서 저장소 상태를 확인한 뒤 pull합니다. 미커밋 변경이 있으면 덮어쓰지 마세요.
- `labdam-auth`는 검증되지 않은 이름의 새 저장소를 만들거나 공개하지 않습니다. 인증 관련 비밀키·D1 데이터·OAuth 코드를 커밋하지 마세요.

## REPODAM 개발 우선순위

1. 인증 Worker의 최신 소스 버전과 해당 배포 콘텐츠를 확인합니다. 공개 Pages 리다이렉트와 인증 보호 앱을 구별합니다.
2. 임상 안전성 PR #33과 성분 안내 PR #34는 병합 및 r4 배포 완료 상태입니다. 이후 변경도 원본 참고치와 판정 보류 경계를 유지합니다.
3. CarePath가 로그인 보호 Worker에 포함되었는지 확인합니다.
4. 배포된 건강기능식품 안내는 **영양소 결핍 또는 복용 필요성을 혈액검사 1개 수치로 단정하지 않는** 경계를 유지합니다. 검사 근거, 결핍 확인 필요성, 약물·질환 금기, 원본 참고범위, 전문가 상담 경계를 먼저 정의합니다.
5. 실제 사용자 건강 데이터를 테스트나 공개 GitHub/PR 로그에 업로드하지 않습니다.
6. Caffeine Atlas의 연구·교육용 공개 QR과 기존 주소는 유지합니다.

## 배포 원본과 검증

- 기존 인증 Worker는 `Haru-today/haru-today.github.io`의 검토된 인증 브랜치 소스를 `.github/workflows/manual-auth-trial-release.yml`에서 커밋 SHA로 고정해 배포합니다. 별도 `labdam-auth` 저장소를 추정해 생성하지 않습니다.
- 배포 대상은 기존 `labdam-free-approval.jleegenomics.workers.dev`이며 로그인·관리자 승인·기존 D1을 유지합니다. 배포 설정의 승인 및 사전 검사를 따르세요.
- `node --test tests/workspace-bootstrap.test.cjs`는 임시 로컬 Git 저장소만 사용해 생성·재실행·기존 파일 보존·충돌·복제 실패·선택 인증 원본을 확인합니다. CI는 macOS 및 Windows에서 각 운영체제의 스크립트를 실행합니다.

## 확인 필요

- 각 사용자 기기의 로컬 폴더 상태와 실제 구성 여부(CI 성공은 사용자 PC 구성 완료를 뜻하지 않습니다)
- Google OAuth 신규 로그인 및 원격 승인·철회 흐름
- 사용자 제공 실제 검사 수치의 전송·보존 동의 및 법률·임상 검토

이 파일은 개발 환경 진입점이며, 전체 기능 완성 또는 제품 출시 검증을 의미하지 않습니다.
