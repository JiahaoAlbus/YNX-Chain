#!/usr/bin/env bash
set -euo pipefail

pattern='-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'

set +e
if command -v rg >/dev/null 2>&1; then
  rg -n --hidden -g '!.git/**' -g '!tools/scaffold-ynx-chain.mjs' -e "$pattern" .
  scan_status=$?
else
  grep -RInE -I \
    --exclude-dir=.git \
    --exclude='scaffold-ynx-chain.mjs' \
    -- "$pattern" .
  scan_status=$?
fi
set -e

case "$scan_status" in
  0)
    echo "possible secret found"
    exit 1
    ;;
  1)
    echo "secret scan passed"
    ;;
  *)
    echo "secret scanner failed with status $scan_status" >&2
    exit 2
    ;;
esac
