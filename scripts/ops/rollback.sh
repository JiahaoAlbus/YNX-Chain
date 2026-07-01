#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/deploy/lib.sh
ynx_load_env
ynx_require_env SERVER_HOST SERVER_USER SSH_KEY_PATH
release="${ROLLBACK_RELEASE:-}"
[[ -n "$release" ]] || { echo "Missing required env: ROLLBACK_RELEASE"; exit 1; }
ynx_ssh "test -x '/opt/ynx-chain/releases/$release/bin/ynx-chaind' && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-chaind' /usr/local/bin/ynx-chaind && sudo systemctl restart ynx-chaind && systemctl --no-pager --full status ynx-chaind"
