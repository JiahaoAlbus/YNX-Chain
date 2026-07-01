#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/package/build-package.mjs ynx-docs-package tmp/packages/docs docs README.md REQUIRED_INPUTS.md ENV_INTAKE_FORM.md
