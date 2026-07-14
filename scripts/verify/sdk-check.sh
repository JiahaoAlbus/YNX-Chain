#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

node --test sdk/js/index.test.mjs sdk/js/wallet.test.mjs
python3 -m unittest sdk/python/test_ynx_client.py
(
  cd sdk/js
  npm pack --dry-run --json >/dev/null
)
node scripts/verify/sdk-release-integrity-check.mjs

echo "sdk-check passed: JavaScript and Python clients, deterministic release artifacts, and clean consumers verified"
