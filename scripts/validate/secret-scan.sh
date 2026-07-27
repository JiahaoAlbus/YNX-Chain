#!/usr/bin/env bash
set -euo pipefail

pattern='-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'
set +e
git grep -nEI --full-name -e "$pattern" -- . ':(exclude)tools/scaffold-ynx-chain.mjs'
status=$?
set -e
case "$status" in
  0)
    echo "possible secret found"
    exit 1
    ;;
  1)
    echo "secret scan passed"
    ;;
  *)
    echo "secret scan failed to inspect the tracked release source" >&2
    exit "$status"
    ;;
esac

