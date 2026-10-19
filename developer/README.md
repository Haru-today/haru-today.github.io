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
curl -fL -o /tmp/labdam-setup.sh https://raw.githubusercontent.com/Haru-today/haru-today.github.io/chore/labdam-workspace-bootstrap-20261020/developer/setup-macos.sh
bash /tmp/labdam-setup.sh
```

다운로드 실행 전에 스크립트를 열어 검토하세요. 저장소 PR이 병합되면 URL의 브랜치를 `main`으로 바꿀 수 있습니다.

### Windows PowerShell

PowerShell에서 저장소에 있는 `developer/setup-windows.ps1` 파일을 먼저 다운로드하고 내용을 검토한 다음 실행합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-windows.ps1
```

기본 경로는 양쪽 모두 홈 디렉터리 아래 `LABDAM-Workspace`입니다. 다른 위치에 만들려면 Mac은 첫 번째 인자, Windows는 `-Root` 매개변수를 전달합니다.

## Codex 사용

- Windows와 Mac에서 같은 저장소를 각자 clone하고 Codex에서 필요한 하위 폴더를 엽니다.
- 수정 전 `git status`로 작업 내용을 확인합니다.
- 각각의 기능별 브랜치에서 작업하고 PR 검토·테스트 후에만 `main`에 병합합니다.
- 다른 PC로 이동할 때는 먼저 현재 PC에서 커밋·푸시하고, 다른 PC에서 저장소 상태를 확인한 뒤 pull합니다. 미커밋 변경이 있으면 덮어쓰지 마세요.
- `labdam-auth`는 검증되지 않은 이름의 새 저장소를 만들거나 공개하지 않습니다. 인증 관련 비밀키·D1 데이터·OAuth 코드를 커밋하지 마세요.

## LabInsight 개발 우선순위

1. 인증 Worker의 최신 소스 버전과 해당 배포 콘텐츠를 확인합니다. 공개 Pages 리다이렉트와 인증 보호 앱을 구별합니다.
2. 열린 임상 안전성 PR #33을 리뷰하고 테스트가 통과한 뒤 병합 여부를 결정합니다.
3. CarePath가 로그인 보호 Worker에 포함되었는지 확인합니다.
4. 건강기능식품 안내는 **영양소 결핍 또는 복용 필요성을 혈액검사 1개 수치로 단정하지 않는** 별도 설계로 추진합니다. 검사 근거, 결핍 확인 필요성, 약물·질환 금기, 원본 참고범위, 전문가 상담 경계를 먼저 정의합니다.
5. 실제 사용자 건강 데이터를 테스트나 공개 GitHub/PR 로그에 업로드하지 않습니다.
6. Caffeine Atlas의 연구·교육용 공개 QR과 기존 주소는 유지합니다.

## 확인 필요

- 인증 Worker 코드의 권위 있는 원본 저장소와 배포 절차
- macOS/Windows 로컬 폴더의 기존 상태
- Google OAuth 실사용 승인 흐름, D1 마이그레이션 및 최신 배포
- 사용자 제공 실제 검사 수치의 전송·보존 동의 및 법률·임상 검토

이 파일은 개발 환경 진입점이며, 전체 기능 완성 또는 제품 출시 검증을 의미하지 않습니다.
