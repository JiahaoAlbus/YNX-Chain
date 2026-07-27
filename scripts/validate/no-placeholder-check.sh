#!/usr/bin/env bash
set -euo pipefail

scan_targets=(Makefile README.md configs internal cmd contracts chain-metadata scripts docs)
bad='example\.com|your_key_here|changeme|fake TPS|fake TVL|fake user|NYXT'

run_scan() {
  if command -v rg >/dev/null 2>&1; then
    rg -n --hidden \
      -g '!.git/**' \
      -g '!tools/scaffold-ynx-chain.mjs' \
      -g '!scripts/validate/no-placeholder-check.sh' \
      -g '!scripts/deploy/lib.sh' \
      -g '!docs/architecture/ZERO_PLACEHOLDER_POLICY.md' \
      -e "$bad" "${scan_targets[@]}"
  elif command -v node >/dev/null 2>&1; then
    node scripts/validate/scan-regex.mjs \
      --pattern "$bad" \
      --exclude-dir .git \
      --exclude-dir node_modules \
      --exclude-dir .gradle \
      --exclude-dir build \
      --exclude-dir dist \
      --exclude-dir release \
      --exclude-dir evidence \
      --exclude-path tools/scaffold-ynx-chain.mjs \
      --exclude-path scripts/validate/no-placeholder-check.sh \
      --exclude-path scripts/deploy/lib.sh \
      --exclude-path docs/architecture/ZERO_PLACEHOLDER_POLICY.md \
      "${scan_targets[@]}"
  else
    echo "placeholder scan unavailable: install ripgrep or Node.js" >&2
    return 2
  fi
}

if run_scan; then
  echo "disallowed deployment filler or fake claim found"
  exit 1
else
  status=$?
  if [[ $status -ne 1 ]]; then
    echo "placeholder scan failed closed (scanner exit $status)" >&2
    exit "$status"
  fi
fi

echo "no disallowed deployment filler found in runtime, docs, or scripts"
