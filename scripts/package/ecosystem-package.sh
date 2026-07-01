#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/package/build-package.mjs ynx-global-ecosystem-package tmp/packages/ecosystem docs/ecosystem docs/custody docs/stablecoin docs/bridge docs/defi docs/developers chain-metadata
