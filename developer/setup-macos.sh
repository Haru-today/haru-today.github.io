#!/usr/bin/env bash
# LABDAM workspace setup (macOS/Linux). Existing repositories are never reset.
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  printf '오류: Git이 설치되어 있지 않습니다. 먼저 Git 또는 Xcode Command Line Tools를 설치하세요.\n' >&2
  exit 1
fi

ROOT="${1:-$HOME/LABDAM-Workspace}"
mkdir -p "$ROOT"

clone_if_missing() {
  local name="$1"
  local url="$2"
  local dest="$ROOT/$name"

  if [ -d "$dest/.git" ]; then
    local origin
    origin="$(git -C "$dest" remote get-url origin 2>/dev/null || true)"
    printf '유지: %s (origin: %s)\n' "$dest" "${origin:-없음}"
    # Intentionally do not pull, reset, checkout, or overwrite user work.
    return 0
  fi

  if [ -e "$dest" ]; then
    printf '오류: %s 폴더가 이미 있지만 Git 저장소가 아닙니다. 자동 덮어쓰기를 중단합니다.\n' "$dest" >&2
    exit 1
  fi

  printf '복제: %s\n' "$url"
  git clone -- "$url" "$dest"
}

clone_if_missing "labdam" "https://github.com/Haru-today/haru-today.github.io.git"
clone_if_missing "labinsight" "https://github.com/Haru-today/labinsight.git"
clone_if_missing "caffeine-atlas" "https://github.com/Haru-today/caffeine-atlas.git"

if [ -n "${LABDAM_AUTH_REPO_URL:-}" ]; then
  clone_if_missing "labdam-auth" "$LABDAM_AUTH_REPO_URL"
else
  printf '안내: 인증 Worker 원본 저장소는 확인되지 않아 자동 복제하지 않았습니다.\n'
fi

printf '\n완료: %s\n' "$ROOT"
printf 'Codex에서 필요한 프로젝트 폴더를 여세요(예: %s/labinsight).\n' "$ROOT"
printf '기존 작업을 보호하기 위해 git pull, reset, 배포는 실행하지 않았습니다.\n'