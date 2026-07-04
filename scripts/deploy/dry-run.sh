#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/deploy.env" <<EOF
TESTNET_DOMAIN=ynx.test
WEBSITE_DOMAIN=www.ynx.test
EXPLORER_DOMAIN=explorer.ynx.test
RPC_DOMAIN=rpc.ynx.test
EVM_RPC_DOMAIN=evm-rpc.ynx.test
FAUCET_DOMAIN=faucet.ynx.test
API_DOMAIN=api.ynx.test
AI_GATEWAY_DOMAIN=ai.ynx.test
TRUST_API_DOMAIN=trust.ynx.test
PAY_API_DOMAIN=pay.ynx.test
IDE_DOMAIN=ide.ynx.test
SERVER_HOST=127.0.0.1
SERVER_USER=ynx
SSH_KEY_PATH=$tmp/ynx_deploy_key
PRIMARY_NODE_HOST=127.0.0.1
PRIMARY_NODE_USER=ynx
PRIMARY_NODE_SSH_KEY=$tmp/ynx_deploy_key
SG_NODE_HOST=43.134.23.58
SG_NODE_USER=root
SG_NODE_SSH_KEY=$tmp/ynx_deploy_key
SG_OBSERVER_FILE=/var/lib/ynx-ops-observer/latest.json
SILICON_VALLEY_NODE_HOST=43.162.100.54
SILICON_VALLEY_NODE_USER=ubuntu
SILICON_VALLEY_NODE_SSH_KEY=$tmp/ynx_deploy_key
SEOUL_NODE_HOST=43.164.132.81
SEOUL_NODE_USER=root
SEOUL_NODE_SSH_KEY=$tmp/ynx_deploy_key
DEPLOY_TARGET=testnet-dry-run
CHAIN_ID=6423
CHAIN_NAME='YNX Testnet'
NATIVE_COIN_NAME=YNXT
NATIVE_SYMBOL=YNXT
YNX_COSMOS_CHAIN_ID=ynx_6423-1
YNX_EVM_CHAIN_ID=6423
YNX_EVM_CHAIN_ID_HEX=0x1917
YNX_NATIVE_COIN_NAME=YNXT
YNX_NATIVE_COIN_SYMBOL=YNXT
YNX_EXPECTED_VALIDATOR_COUNT=4
GENESIS_VALIDATOR_NAME=ynx-validator-dry-run
VALIDATOR_KEY_PATH=$tmp/validator_key
FAUCET_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000642
DEPLOYER_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000643
TREASURY_ADDRESS=0x0000000000000000000000000000000000000642
FOUNDATION_ADDRESS=0x0000000000000000000000000000000000000643
TEAM_VESTING_ADDRESS=0x0000000000000000000000000000000000000645
POSTGRES_URL=postgres://ynx:ynx@127.0.0.1:5432/ynx
REDIS_URL=redis://127.0.0.1:6379/0
OBJECT_STORAGE_ENDPOINT=https://storage.ynx.test
OBJECT_STORAGE_BUCKET=ynx-testnet
OBJECT_STORAGE_ACCESS_KEY=dry-run-access
OBJECT_STORAGE_SECRET_KEY=dry-run-secret
OPENAI_API_KEY=dry-run-openai-key
AI_MODEL_NAME=gpt-4.1-mini
EMAIL_PROVIDER=dry-run-mail
EMAIL_API_KEY=dry-run-email-key
WEBHOOK_SECRET=dry-run-webhook-secret
JWT_SECRET=dry-run-jwt-secret
SESSION_SECRET=dry-run-session-secret
RATE_LIMIT_SECRET=dry-run-rate-limit-secret
PAY_MERCHANT_SECRET=dry-run-pay-secret
TRUST_REPORT_SIGNING_KEY=dry-run-trust-signing-key
MONITORING_ADMIN_PASSWORD=dry-run-monitoring-password
BACKUP_STORAGE_PATH=/var/backups/ynx-chain
SSL_EMAIL=ops@ynx.test
NGINX_SERVER_NAME=ynx.test
GITHUB_REPO_TOKEN=dry-run-github-token
EOF
touch "$tmp/ynx_deploy_key" "$tmp/validator_key"

dry_run_out="$tmp/deploy-dry-run.out"
ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 ./scripts/deploy/deploy-testnet.sh | tee "$dry_run_out"

commit="$(git rev-parse --short=12 HEAD)"
release_dir="tmp/deploy/ynx-chain-${commit}"
grep -Fq "FAUCET_PRIVATE_KEY=" "$release_dir/config/ynx-faucetd.env" || { echo "faucet env missing FAUCET_PRIVATE_KEY"; exit 1; }
if grep -Fq "FAUCET_PRIVATE_KEY=" "$release_dir/config/ynx-chaind.env"; then
  echo "shared chain env must not contain FAUCET_PRIVATE_KEY"
  exit 1
fi
grep -Fq "EnvironmentFile=/etc/ynx/ynx-faucetd.env" "$release_dir/systemd/ynx-faucetd.service" || { echo "faucet service missing secret env file"; exit 1; }
grep -Fq "/home/ubuntu/.ynx-v2" "$dry_run_out" || { echo "legacy home data path missing from predeploy backup"; exit 1; }
grep -Fq "/root/.ynx-v2" "$dry_run_out" || { echo "legacy root data path missing from predeploy backup"; exit 1; }
grep -Fq "ynx-v2-node.service" "$dry_run_out" || { echo "legacy primary service backup missing"; exit 1; }
grep -Fq "ynx-v2-peer.service" "$dry_run_out" || { echo "legacy peer service backup missing"; exit 1; }
