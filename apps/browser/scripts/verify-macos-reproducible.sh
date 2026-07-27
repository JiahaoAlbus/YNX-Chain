#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$ROOT/dist/macos/YNX-Browser-Testnet-Preview-macOS.zip"

bash "$ROOT/scripts/build-macos-app.sh"
read -r first_hash _ < <(shasum -a 256 "$ZIP")

bash "$ROOT/scripts/build-macos-app.sh"
read -r second_hash _ < <(shasum -a 256 "$ZIP")

if [[ "$first_hash" != "$second_hash" ]]; then
  echo "macOS preview is not reproducible: $first_hash != $second_hash" >&2
  exit 1
fi

echo "macOS preview reproducibility passed: $second_hash"
