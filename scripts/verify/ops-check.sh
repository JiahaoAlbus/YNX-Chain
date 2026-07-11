#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
touch "$tmp/key"
cat > "$tmp/env" <<EOF
SERVER_HOST=127.0.0.1
SERVER_USER=ynx
SSH_KEY_PATH=$tmp/key
PRIMARY_NODE_HOST=127.0.0.1
PRIMARY_NODE_USER=ynx
PRIMARY_NODE_SSH_KEY=$tmp/key
SG_NODE_HOST=43.134.23.58
SG_NODE_USER=root
SG_NODE_SSH_KEY=$tmp/key
SILICON_VALLEY_NODE_HOST=43.162.100.54
SILICON_VALLEY_NODE_USER=ubuntu
SILICON_VALLEY_NODE_SSH_KEY=$tmp/key
SEOUL_NODE_HOST=43.164.132.81
SEOUL_NODE_USER=root
SEOUL_NODE_SSH_KEY=$tmp/key
BACKUP_STORAGE_PATH=/var/backups/ynx-chain
EOF

out="$tmp/ops-dry-run.txt"
for script in status logs restart backup rollback; do
  ROLLBACK_RELEASE=ynx-chain-test ENV_FILE="$tmp/env" DEPLOY_DRY_RUN=1 bash "scripts/ops/$script.sh" >>"$out"
done

for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role]" "$out" || { echo "missing ops dry-run role: $role"; exit 1; }
done
grep -Fq "ynx-indexerd" "$out" || { echo "primary full-stack service not covered"; exit 1; }
grep -Fq "ynx-ai-gatewayd" "$out" || { echo "primary AI Gateway service not covered"; exit 1; }
grep -Fq "ynx-payd" "$out" || { echo "primary Pay Gateway service not covered"; exit 1; }
grep -Fq "ynx-chain-testnet-" "$out" || { echo "backup path not covered"; exit 1; }
grep -Fq "/home/ubuntu/.ynx-v2" "$out" || { echo "legacy home data path not covered"; exit 1; }
grep -Fq "ynx-v2-peer.service" "$out" || { echo "legacy peer service backup not covered"; exit 1; }
grep -Fq "ynx-chain-test/bin/ynx-chaind" "$out" || { echo "rollback release path not covered"; exit 1; }
echo "ops-check passed: multi-node status/logs/restart/backup/rollback dry-run paths are wired"
