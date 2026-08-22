#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
probe="$(mktemp -d)"
trap 'rm -rf "$probe"' EXIT
make_receipts() {
  local dir=$1
  mkdir -p "$dir/nested"
  printf 'candidate\n' >"$dir/candidate-created-state.json"
  printf 'cleanup\n' >"$dir/cleanup.json"
  printf 'result\n' >"$dir/result.txt"
  printf 'nested\n' >"$dir/nested/final.json"
  (cd "$dir" && find . -xdev -type f ! -name SHA256SUMS ! -name .SHA256SUMS.tmp -print0 | LC_ALL=C sort -z | xargs -0 sha256sum >.SHA256SUMS.tmp && mv -f .SHA256SUMS.tmp SHA256SUMS)
}
expect_fail() { if python3 "$root/verify-finance-receipt-manifest.py" "$1" >/dev/null 2>&1; then echo "expected failure: $2" >&2; exit 1; fi; }
good="$probe/good"; make_receipts "$good"
python3 "$root/verify-finance-receipt-manifest.py" "$good"
grep -q '  ./candidate-created-state.json$' "$good/SHA256SUMS"
digest="$probe/digest"; cp -R "$good" "$digest"; printf 'tampered\n' >>"$digest/result.txt"; expect_fail "$digest" digest
missing="$probe/missing"; cp -R "$good" "$missing"; mv "$missing/cleanup.json" "$missing/cleanup.json.removed"; expect_fail "$missing" missing
extra="$probe/extra"; cp -R "$good" "$extra"; printf 'extra\n' >"$extra/extra.json"; expect_fail "$extra" extra
duplicate="$probe/duplicate"; cp -R "$good" "$duplicate"; head -n1 "$duplicate/SHA256SUMS" >>"$duplicate/SHA256SUMS"; expect_fail "$duplicate" duplicate
symlink="$probe/symlink"; cp -R "$good" "$symlink"; ln -s result.txt "$symlink/link.json"; expect_fail "$symlink" symlink
echo 'finance receipt manifest regression: pass'
