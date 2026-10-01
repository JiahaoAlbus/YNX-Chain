#!/usr/bin/env bash
set -euo pipefail
# Use immutable Cloud source without copying it into the Social worktree.
cloud_repo=${1:?Cloud owner repository path required}
cloud_commit=${2:?Exact Cloud commit required}
case "$cloud_commit" in
  *[!0-9a-f]*|'') printf 'Expected full hexadecimal Cloud commit\n' >&2; exit 2 ;;
esac
[[ ${#cloud_commit} == 40 ]] || exit 2
root=$(cd "$(dirname "$0")/../../.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/social-cloud-contract.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
git -C "$cloud_repo" archive "$cloud_commit" internal/cloud | tar -x -C "$scratch"
node - "$root" "$scratch" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [root, scratch] = process.argv.slice(2);
const target = path.join(root, 'internal/cloud');
const source = path.join(scratch, 'internal/cloud');
const replacement = {};
for (const name of new Set([...(fs.existsSync(target) ? fs.readdirSync(target) : []), ...fs.readdirSync(source)])) {
  if (!name.endsWith('.go')) continue;
  replacement[path.join(target, name)] = fs.existsSync(path.join(source, name)) ? path.join(source, name) : '';
}
fs.writeFileSync(path.join(scratch, 'overlay.json'), JSON.stringify({Replace: replacement}));
NODE
cd "$root"
# Go vet requires a physical cwd for the virtual Cloud package. This run tests
# actual HTTP behavior; run Cloud's own vet in its owner's physical worktree.
go test -vet=off -overlay "$scratch/overlay.json" -tags social_cloud_integration ./internal/social -run 'TestCloud(Object|Authority)' -count=1 -v
