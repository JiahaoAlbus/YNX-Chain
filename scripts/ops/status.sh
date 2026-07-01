#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/deploy/lib.sh
ynx_load_env
ynx_require_env SERVER_HOST SERVER_USER SSH_KEY_PATH
ynx_ssh "systemctl --no-pager --full status ynx-chaind || true; systemctl --no-pager --full status ynx-indexerd || true; systemctl --no-pager --full status ynx-explorerd || true; curl -fsS http://127.0.0.1:6420/status; curl -fsS http://127.0.0.1:6426/health; curl -fsS http://127.0.0.1:6427/health"
