#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/deploy/lib.sh
ynx_load_env
ynx_require_env SERVER_HOST SERVER_USER SSH_KEY_PATH
ynx_ssh "sudo systemctl restart ynx-chaind && sudo systemctl restart ynx-indexerd && sudo systemctl restart ynx-explorerd && systemctl --no-pager --full status ynx-chaind && systemctl --no-pager --full status ynx-indexerd && systemctl --no-pager --full status ynx-explorerd"
