#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/package/build-package.mjs ynx-global-ecosystem-package tmp/packages/ecosystem docs/ecosystem docs/custody docs/stablecoin docs/bridge docs/defi docs/developers chain-metadata contracts/tokens contracts/resource-market resource-market indexer cmd/ynx-indexerd internal/indexer token-lists dex infra/monitoring infra/docker/ynx-indexerd.Dockerfile infra/systemd/ynx-indexerd.example.service hardhat.config.ts foundry.toml package.json package-lock.json scripts/contracts scripts/verify/contract-tooling-check.mjs scripts/verify/contract-tooling-check.sh scripts/verify/monitoring-check.sh scripts/verify/indexer-check.sh
