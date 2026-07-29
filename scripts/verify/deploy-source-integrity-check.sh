#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

git -C "$tmp" init -q
git -C "$tmp" config user.name "YNX Deploy Check"
git -C "$tmp" config user.email "deploy-check@ynx.invalid"
printf 'tracked\n' > "$tmp/tracked.txt"
printf 'ignored.txt\n' > "$tmp/.gitignore"
git -C "$tmp" add tracked.txt .gitignore
git -C "$tmp" commit -qm "fixture"

(cd "$tmp" && ynx_require_clean_worktree)

printf 'ignored\n' > "$tmp/ignored.txt"
(cd "$tmp" && ynx_require_clean_worktree)

printf 'changed\n' >> "$tmp/tracked.txt"
if (cd "$tmp" && ynx_require_clean_worktree >/dev/null 2>&1); then
  echo "tracked modifications must fail deployment source integrity" >&2
  exit 1
fi
git -C "$tmp" restore tracked.txt

printf 'untracked\n' > "$tmp/untracked.txt"
if (cd "$tmp" && ynx_require_clean_worktree >/dev/null 2>&1); then
  echo "untracked files must fail deployment source integrity" >&2
  exit 1
fi

echo "deploy-source-integrity-check passed: clean and ignored-only trees pass; tracked and untracked changes fail"
