#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  pem_begin='-----BEGIN '
  pem_end='PRIVATE KEY-----'
  provider_prefix='s''k-'
  aws_prefix='A''KIA'
  messaging_prefix='xox''[baprs]-'
  fallback_pattern="${pem_begin}(RSA |OPENSSH |EC )?${pem_end}|${provider_prefix}[A-Za-z0-9]{20,}|${aws_prefix}[0-9A-Z]{16}|${messaging_prefix}"

  set +e
  grep -RInE \
    --exclude='scaffold-ynx-chain.mjs' \
    --exclude='secret-scan.sh' \
    --exclude-dir='.git' \
    --exclude-dir='node_modules' \
    --exclude-dir='.expo' \
    -e "$fallback_pattern" .
  scan_status=$?
  set -e

  case "$scan_status" in
    0)
      echo "possible secret found"
      exit 1
      ;;
    1)
      echo "secret scan passed"
      exit 0
      ;;
    *)
      echo "secret scan failed with status $scan_status"
      exit "$scan_status"
      ;;
  esac
fi

if rg -n --hidden -g '!.git/**' -g '!tools/scaffold-ynx-chain.mjs' -g '!scripts/validate/secret-scan.sh' -e '-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-' .; then
  echo "possible secret found"
  exit 1
fi
echo "secret scan passed"

