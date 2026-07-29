#!/usr/bin/env bash
set -euo pipefail

scan_root="${1:-.}"
default_pattern='-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{36,255}'
pattern="${YNX_SECRET_SCAN_PATTERN:-$default_pattern}"

if [[ ! -d "$scan_root" ]]; then
  echo "secret scan root is not a directory: ${scan_root}" >&2
  exit 2
fi

scan_with_rg() {
  rg -n --hidden \
    -g '!.git/**' \
    -g '!node_modules/**' \
    -g '!dist/**' \
    -g '!build/**' \
    -g '!.expo/**' \
    -g '!Pods/**' \
    -g '!DerivedData/**' \
    -g '!coverage/**' \
    -g '!release/sbom/**' \
    -g '!tools/scaffold-ynx-chain.mjs' \
    -g '!scripts/validate/secret-scan.sh' \
    -e "$pattern" "$scan_root"
}

scan_with_grep() {
  grep -RInE \
    --binary-files=without-match \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    --exclude-dir=build \
    --exclude-dir=.expo \
    --exclude-dir=Pods \
    --exclude-dir=DerivedData \
    --exclude-dir=coverage \
    --exclude-dir=sbom \
    --exclude=scaffold-ynx-chain.mjs \
    --exclude=secret-scan.sh \
    -- "$pattern" "$scan_root"
}

if command -v rg >/dev/null 2>&1; then
  scanner="ripgrep"
  if scan_with_rg; then
    echo "possible secret found by ${scanner}" >&2
    exit 1
  fi
elif command -v grep >/dev/null 2>&1; then
  scanner="grep fallback"
  if scan_with_grep; then
    echo "possible secret found by ${scanner}" >&2
    exit 1
  fi
else
  echo "secret scan unavailable: install ripgrep or provide grep; refusing to pass open" >&2
  exit 2
fi

echo "secret scan passed (${scanner})"
