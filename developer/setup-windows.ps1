# LABDAM workspace setup for Windows PowerShell (no reset/pull/overwrite)
param([string]$Root = (Join-Path $HOME "LABDAM-Workspace"))
$ErrorActionPreference = "Stop"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git이 설치되지 않았습니다. Git for Windows 설치 후 다시 실행하세요." }
New-Item -ItemType Directory -Force -Path $Root | Out-Null
function Clone-IfMissing([string]$Name, [string]$Url) {
  $dest = Join-Path $Root $Name
  if (Test-Path -LiteralPath (Join-Path $dest ".git") -PathType Container) {
    Write-Host "유지: $dest (기존 Git 작업 보존)"
    return
  }
  if (Test-Path -LiteralPath $dest) {
    throw "기존 폴더 $dest 에 Git 저장소가 없습니다. 덮어쓰지 않고 중단합니다."
  }
  Write-Host "복제: $Url"
  & git clone -- $Url $dest
  if ($LASTEXITCODE -ne 0) { throw "복제 실패: $Url" }
}
Clone-IfMissing "labdam" "https://github.com/Haru-today/haru-today.github.io.git"
Clone-IfMissing "labinsight" "https://github.com/Haru-today/labinsight.git"
Clone-IfMissing "caffeine-atlas" "https://github.com/Haru-today/caffeine-atlas.git"
if ($env:LABDAM_AUTH_REPO_URL) {
  Clone-IfMissing "labdam-auth" $env:LABDAM_AUTH_REPO_URL
} else {
  Write-Host "인증 Worker 원본 저장소는 확인되지 않아 자동 복제하지 않았습니다."
}
Write-Host "완료: $Root"
Write-Host "Codex에서 각 하위 프로젝트 폴더를 여세요. 기존 로컬 변경이나 운영 배포를 수정하지 않았습니다."
