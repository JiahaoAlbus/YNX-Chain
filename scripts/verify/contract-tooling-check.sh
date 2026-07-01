#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
node ./scripts/verify/contract-tooling-check.mjs
