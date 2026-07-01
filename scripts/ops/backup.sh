#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/deploy/lib.sh
ynx_load_env
ynx_require_env SERVER_HOST SERVER_USER SSH_KEY_PATH BACKUP_STORAGE_PATH
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
ynx_ssh "sudo install -d -m 0700 '$BACKUP_STORAGE_PATH' && sudo tar -czf '$BACKUP_STORAGE_PATH/ynx-chain-testnet-$stamp.tar.gz' /var/lib/ynx-chain/testnet /var/lib/ynx-chain/indexer /etc/ynx/ynx-chaind.env /etc/systemd/system/ynx-chaind.service /etc/systemd/system/ynx-indexerd.service 2>/dev/null && sudo ls -lh '$BACKUP_STORAGE_PATH/ynx-chain-testnet-$stamp.tar.gz'"
