#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${repo_root}" ]]; then
  echo "Not inside a git repository."
  exit 1
fi

cd "${repo_root}"

echo "== Safety checks =="
git status --short
echo "---"
git diff --name-only
echo "---"
git diff --cached --name-only
echo ""

commit_group() {
  local message="$1"
  shift
  local files=("$@")

  if [[ ${#files[@]} -eq 0 ]]; then
    echo "No files supplied for commit: ${message}"
    return 1
  fi

  if [[ -z "$(git status --porcelain -- "${files[@]}")" ]]; then
    echo "Skipping ${message} (no changes in target files)."
    return 0
  fi

  echo "== Creating commit: ${message} =="
  git add -- "${files[@]}"

  if git diff --cached --quiet -- "${files[@]}"; then
    echo "Skipping ${message} (nothing staged for target files)."
    return 0
  fi

  git commit -m "${message}"
  git status --short
  echo ""
}

commit_group "docs(project): update roadmap, architecture notes, and setup documentation" \
  README.md \
  plan.md \
  phase2.md \
  schema.md \
  ui-redesign.md \
  changelog.md \
  frontend/DESIGN.md \
  .github/copilot-instructions.md

commit_group "chore(repo): update ignore and workspace lockfile state" \
  .gitignore \
  package-lock.json

echo "All commit groups processed."
