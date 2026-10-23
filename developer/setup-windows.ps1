# LABDAM workspace setup for Windows PowerShell (no reset/pull/overwrite)
param([string]$Root = (Join-Path $HOME "LABDAM-Workspace"))
$ErrorActionPreference = "Stop"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git이 설치되지 않았습니다. Git for Windows 설치 후 다시 실행하세요." }
New-Item -ItemType Directory -Force -Path $Root | Out-Null
function Get-RepositoryIdentity([string]$Value) {
  # Read the stored URL before Git's insteadOf rewrites; keep local paths exact.
  if ($Value -match '^(https://([^/@]+@)?github\.com/|git@github\.com:|ssh://git@github\.com(:22)?/)([a-z0-9_.-]+/[a-z0-9_.-]+)/*$') {
    $repository = ($Matches[4] -replace '\.git$', '').ToLowerInvariant()
    # Preserve existing checkouts of the repository's former name.
    if ($repository -eq "haru-today/labinsight") { $repository = "haru-today/repodam" }
    return "github.com/" + $repository
  }
  return $Value
}
function Clone-IfMissing([string]$Name, [string]$Url) {
  $dest = Join-Path $Root $Name
  if (Test-Path -LiteralPath (Join-Path $dest ".git")) {
    $inside = & git -C $dest rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -eq 0 -and $inside -eq "true") {
      $origin = @(& git -C $dest config --get-all remote.origin.url 2>$null)
      if ($LASTEXITCODE -ne 0 -or $origin.Count -ne 1 -or (Get-RepositoryIdentity $origin[0]) -cne (Get-RepositoryIdentity $Url)) {
        throw "$dest 의 origin이 예상 저장소와 다릅니다. 기존 작업을 보존하고 중단합니다."
      }
      Write-Host "유지: $dest (원본 저장소 확인, 기존 Git 작업 보존)"
      return
    }
  }
  if (Test-Path -LiteralPath $dest) {
    throw "기존 폴더 $dest 에 Git 저장소가 없습니다. 덮어쓰지 않고 중단합니다."
  }
  Write-Host "복제: $dest"
  # Native Git errors can echo credentials from a URL; report only the path.
  & git clone --quiet -- $Url $dest *> $null
  if ($LASTEXITCODE -ne 0) { throw "$dest 복제 실패. Git 인증과 원본 접근 권한을 확인하세요." }
}
Clone-IfMissing "labdam" "https://github.com/Haru-today/haru-today.github.io.git"
Clone-IfMissing "labinsight" "https://github.com/Haru-today/repodam.git"
Clone-IfMissing "caffeine-atlas" "https://github.com/Haru-today/caffeine-atlas.git"
if ($env:LABDAM_AUTH_REPO_URL) {
  Clone-IfMissing "labdam-auth" $env:LABDAM_AUTH_REPO_URL
} else {
  Write-Host "인증 Worker 원본 저장소는 확인되지 않아 자동 복제하지 않았습니다."
}
Write-Host "완료: $Root"
Write-Host "Codex에서 각 하위 프로젝트 폴더를 여세요. 기존 로컬 변경이나 운영 배포를 수정하지 않았습니다."
