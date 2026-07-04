#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/deploy/lib.sh
ynx_load_env
ynx_require_env SERVER_HOST SERVER_USER SSH_KEY_PATH
ynx_ssh "journalctl -u ynx-chaind -n ${LINES:-200} --no-pager; journalctl -u ynx-indexerd -n ${LINES:-200} --no-pager; journalctl -u ynx-explorerd -n ${LINES:-200} --no-pager; journalctl -u ynx-faucetd -n ${LINES:-200} --no-pager"
