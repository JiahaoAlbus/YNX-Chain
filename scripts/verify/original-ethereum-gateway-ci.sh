#!/usr/bin/env bash
set -euo pipefail
events="$RUNNER_TEMP/ynx-original-ethereum-gateway-tests.jsonl"
if ! go test -json -p 1 -count=1 -timeout=180s ./internal/bftgateway ./cmd/ynx-bft-gatewayd > "$events"; then
  cat "$events"
  exit 1
fi
python3 -B scripts/verify/qualify_original_ethereum_ci.py bftgateway "$events"
python3 -B scripts/verify/test_qualify_original_ethereum_ci.py
