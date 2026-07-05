#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
npm run hardhat:build
node ./scripts/verify/contract-tooling-check.mjs
