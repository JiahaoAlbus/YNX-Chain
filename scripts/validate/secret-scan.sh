#!/usr/bin/env bash
set -euo pipefail

pattern='-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'

if command -v rg >/dev/null 2>&1; then
  scanner=(rg -n --hidden -g '!.git/**' -g '!tools/scaffold-ynx-chain.mjs' -g '!scripts/validate/secret-scan.sh' -e "$pattern" .)
elif command -v grep >/dev/null 2>&1; then
  scanner=(grep -RInE --exclude='scaffold-ynx-chain.mjs' --exclude='secret-scan.sh' --exclude-dir='.git' -- "$pattern" .)
else
  echo "secret scanner unavailable: install ripgrep or grep" >&2
  exit 2
fi

set +e
"${scanner[@]}"
scan_status=$?
set -e

case "$scan_status" in
  0)
    echo "possible secret found" >&2
    exit 1
    ;;
  1)
    echo "secret scan passed"
    ;;
  *)
    echo "secret scan failed with status $scan_status" >&2
    exit 2
    ;;
esac
