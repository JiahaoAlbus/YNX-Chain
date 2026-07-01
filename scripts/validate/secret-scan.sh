#!/usr/bin/env bash
set -euo pipefail

if rg -n --hidden -g '!.git/**' -g '!tools/scaffold-ynx-chain.mjs' -e '-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-' .; then
  echo "possible secret found"
  exit 1
fi
echo "secret scan passed"

