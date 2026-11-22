#!/usr/bin/env bash
set -euo pipefail
chain_events="$RUNNER_TEMP/ynx-original-ethereum-static-caller-tests.jsonl"
if ! go test -json -p 1 -count=1 -timeout=90s -run '^(TestStaticEVMCallerRequiresOriginalContext|TestStaticPinnedERC20CallerFailsClosed)$' ./internal/chain > "$chain_events"; then
  cat "$chain_events"
  exit 1
fi
python3 -B scripts/verify/qualify_original_ethereum_ci.py chain "$chain_events"
events="$RUNNER_TEMP/ynx-original-ethereum-gateway-tests.jsonl"
if ! go test -json -p 1 -count=1 -timeout=180s ./internal/bftgateway ./cmd/ynx-bft-gatewayd > "$events"; then
  cat "$events"
  exit 1
fi
python3 -B scripts/verify/qualify_original_ethereum_ci.py bftgateway "$events"
python3 -B scripts/verify/test_qualify_original_ethereum_ci.py
