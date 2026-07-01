#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/deploy/lib.sh
ynx_load_env
ynx_require_env SERVER_HOST SERVER_USER SSH_KEY_PATH
release="${ROLLBACK_RELEASE:-}"
[[ -n "$release" ]] || { echo "Missing required env: ROLLBACK_RELEASE"; exit 1; }
ynx_ssh "test -x '/opt/ynx-chain/releases/$release/bin/ynx-chaind' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-indexerd' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-explorerd' && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-chaind' /usr/local/bin/ynx-chaind && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-indexerd' /usr/local/bin/ynx-indexerd && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-explorerd' /usr/local/bin/ynx-explorerd && sudo systemctl restart ynx-chaind && sudo systemctl restart ynx-indexerd && sudo systemctl restart ynx-explorerd && systemctl --no-pager --full status ynx-chaind && systemctl --no-pager --full status ynx-indexerd && systemctl --no-pager --full status ynx-explorerd"
