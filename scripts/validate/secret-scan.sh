#!/usr/bin/env bash
set -euo pipefail

run_scan() {
  if command -v rg >/dev/null 2>&1; then
    rg -n --hidden -g '!.git/**' -g '!tools/scaffold-ynx-chain.mjs' -e '-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-' .
  elif command -v node >/dev/null 2>&1; then
    pattern="$(node -e "const fs=require('node:fs');const text=fs.readFileSync('scripts/validate/secret-scan.sh','utf8');const match=text.match(/-e '([^']+)'/);if(!match)process.exit(2);process.stdout.write(match[1])")"
    node scripts/validate/scan-regex.mjs \
      --pattern "$pattern" \
      --exclude-dir .git \
      --exclude-dir node_modules \
      --exclude-dir .gradle \
      --exclude-dir build \
      --exclude-dir dist \
      --exclude-dir release \
      --exclude-dir evidence \
      --exclude-path tools/scaffold-ynx-chain.mjs \
      --exclude-path scripts/validate/secret-scan.sh \
      --exclude-path scripts/validate/scan-regex.mjs \
      --exclude-path scripts/validate/scan-regex.test.mjs \
      .
  else
    echo "secret scan unavailable: install ripgrep or Node.js" >&2
    return 2
  fi
}

if run_scan; then
  echo "possible secret found"
  exit 1
else
  status=$?
  if [[ $status -ne 1 ]]; then
    echo "secret scan failed closed (scanner exit $status)" >&2
    exit "$status"
  fi
fi

echo "secret scan passed"

