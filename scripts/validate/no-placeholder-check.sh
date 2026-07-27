#!/usr/bin/env bash
set -euo pipefail

scan_targets=(Makefile README.md configs internal cmd contracts chain-metadata scripts docs)
bad='example\.com|your_key_here|changeme|fake TPS|fake TVL|fake user|NYXT'
set +e
git grep -nEI --full-name -e "$bad" -- "${scan_targets[@]}" \
  ':(exclude)tools/scaffold-ynx-chain.mjs' \
  ':(exclude)scripts/validate/no-placeholder-check.sh' \
  ':(exclude)scripts/deploy/lib.sh' \
  ':(exclude)docs/architecture/ZERO_PLACEHOLDER_POLICY.md'
status=$?
set -e
case "$status" in
  0)
    echo "disallowed deployment filler or fake claim found"
    exit 1
    ;;
  1)
    echo "no disallowed deployment filler found in runtime, docs, or scripts"
    ;;
  *)
    echo "placeholder scan failed to inspect the tracked release source" >&2
    exit "$status"
    ;;
esac
