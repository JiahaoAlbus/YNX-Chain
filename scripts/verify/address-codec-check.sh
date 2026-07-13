#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/accountaddress ./internal/consensus ./internal/api ./internal/explorer ./cmd/ynx-consensus-account-key ./cmd/ynx-consensus-tx
node --test sdk/js/index.test.mjs
python3 -m unittest sdk/python/test_ynx_client.py

echo "address-codec-check passed: Go, JavaScript, Python, REST, CLI, and Explorer agree on ynx1/0x address identity"
