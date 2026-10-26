#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
npm run hardhat:build
node --test ./scripts/contracts/hardhat-zod4-compat.test.mjs
npm run contracts:selectors
node ./scripts/verify/contract-tooling-check.mjs
