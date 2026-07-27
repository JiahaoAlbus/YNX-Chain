#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

bash -n scripts/deploy/deploy-yusd-sandbox.sh scripts/deploy/remote/install-yusd-sandbox.sh
go test -race ./internal/yusdsandbox ./cmd/ynx-yusd-sandboxd
go vet ./internal/yusdsandbox ./cmd/ynx-yusd-sandboxd
go build -trimpath -o "$tmp/ynx-yusd-sandboxd" ./cmd/ynx-yusd-sandboxd
YNX_YUSD_SANDBOX_STATE_PATH="$tmp/state/state.json" \
  YNX_YUSD_SANDBOX_API_KEY=testnet-deploy-config-check-key \
  "$tmp/ynx-yusd-sandboxd" --check-config >/dev/null
test ! -e "$tmp/state/state.json" || { echo "YUSD config check must not create runtime state"; exit 1; }

for required in \
  'YNX_YUSD_SANDBOX_STATE_PATH=/var/lib/ynx-chain/yusd-sandbox/state.json' \
  'YNX_MUTATION_FREEZE_FILE=/var/lib/ynx-chain/mutation-freeze.json' \
  'ynx-yusd-sandboxd --check-config' \
  'systemctl restart ynx-yusd-sandboxd.service' \
  'realTestnetCycle=reserve-mint-redeem-fulfill realityValue=false'
do
  grep -Fq "$required" scripts/deploy/deploy-yusd-sandbox.sh scripts/deploy/remote/install-yusd-sandbox.sh ||
    { echo "YUSD Testnet deployment is missing gate: $required"; exit 1; }
done

for required in \
  '/usr/local/bin/ynx-yusd-sandboxd' \
  '/etc/systemd/system/ynx-yusd-sandboxd.service' \
  '/etc/ynx/ynx-yusd-sandboxd.env' \
  '/var/lib/ynx-chain/yusd-sandbox/state.json'
do
  grep -Fq "$required" scripts/deploy/remote/install-yusd-sandbox.sh ||
    { echo "YUSD Testnet rollback is missing path: $required"; exit 1; }
done

grep -Fq 'ReadWritePaths=/var/lib/ynx-chain/yusd-sandbox' infra/monitoring/systemd/ynx-yusd-sandboxd.service
grep -Fq 'mutationfreeze.FromEnv' cmd/ynx-yusd-sandboxd/main.go
DEPLOY_DRY_RUN=1 bash scripts/deploy/deploy-yusd-sandbox.sh
echo "yusd-testnet-deploy-check passed: existing 1:1 Sandbox Runtime has scoped rollback-safe Testnet deployment and a real reserve-mint-redeem-fulfill proof"
