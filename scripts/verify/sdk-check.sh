#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

node --test sdk/js/index.test.mjs sdk/js/wallet.test.mjs
if [[ -n "${PYTHON_BIN:-}" ]]; then
  python_bin="$PYTHON_BIN"
elif [[ -x /usr/bin/python3 ]]; then
  python_bin=/usr/bin/python3
else
  python_bin=python3
fi
if ! "$python_bin" -c 'import sys' >/dev/null 2>&1; then
  if [[ -x /usr/bin/python3 ]] && /usr/bin/python3 -c 'import sys' >/dev/null 2>&1; then
    python_bin=/usr/bin/python3
  else
    echo "sdk-check failed: no working Python 3 interpreter found" >&2
    exit 1
  fi
fi
"$python_bin" -m unittest sdk/python/test_ynx_client.py
(
  cd sdk/js
  npm pack --dry-run --json >/dev/null
)
PYTHON="$python_bin" node scripts/verify/sdk-release-integrity-check.mjs

echo "sdk-check passed: JavaScript and Python clients, deterministic release artifacts, and clean consumers verified"
