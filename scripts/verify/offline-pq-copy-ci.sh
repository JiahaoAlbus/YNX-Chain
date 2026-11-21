#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  chain)
    python3 -B scripts/verify/qualify_offline_pq_copy_ci.py chain "$RUNNER_TEMP/ynx-legacy-native-integration.jsonl"
    ;;
  chaind)
    events="$RUNNER_TEMP/ynx-offline-pq-copy-command-tests.jsonl"
    if ! go test -json -p 1 -count=1 -timeout=90s -run '^TestOfflinePQScheduledCopy' ./cmd/ynx-chaind > "$events"; then
      cat "$events"
      exit 1
    fi
    python3 -B scripts/verify/qualify_offline_pq_copy_ci.py chaind "$events"
    python3 -B scripts/verify/test_qualify_offline_pq_copy_ci.py
    # The private copy remains unavailable without Unix owner metadata, but
    # adding it must not break unrelated Windows builds of the Chain package.
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -p 1 ./internal/chain
    ;;
  *) exit 2 ;;
esac
