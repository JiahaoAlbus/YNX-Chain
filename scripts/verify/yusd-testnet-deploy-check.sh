#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

bash -n scripts/deploy/deploy-yusd-sandbox.sh scripts/deploy/remote/install-yusd-sandbox.sh \
  scripts/deploy/deploy-testnet.sh scripts/deploy/dry-run.sh scripts/deploy/check-local-services.sh \
  scripts/deploy/remote/install-yusd-env.sh scripts/ops/backup.sh scripts/ops/rollback.sh scripts/ops/lib.sh
node --check scripts/deploy/write-release-manifest.mjs
node --check scripts/verify/release-manifest-check.mjs
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

for required in \
  'bin/ynx-yusd-sandboxd' \
  'config/ynx-yusd-sandboxd.env' \
  'config/ynx-explorerd.env' \
  'systemd/ynx-yusd-sandboxd.service' \
  'scripts/install-yusd-env.sh'
do
  grep -Fq "$required" scripts/deploy/write-release-manifest.mjs \
    scripts/verify/release-manifest-check.mjs scripts/deploy/dry-run.sh ||
    { echo "full release lifecycle missing YUSD artifact: $required"; exit 1; }
done

for required in \
  'YNX_YUSD_SANDBOX_URL=http://127.0.0.1:6490' \
  'YNX_PUBLIC_YUSD_SANDBOX_URL=https://${EXPLORER_DOMAIN}/api/stable/yusd-sandbox' \
  "scripts/install-yusd-env.sh' '\$remote_dir/config/ynx-yusd-sandboxd.env" \
  'ynx-yusd-sandboxd --check-config' \
  'systemctl restart ynx-yusd-sandboxd'
do
  grep -Fq "$required" scripts/deploy/deploy-testnet.sh ||
    { echo "full Testnet deploy missing YUSD gate: $required"; exit 1; }
done

for required in \
  '/var/lib/ynx-chain/yusd-sandbox' \
  '/etc/ynx/ynx-yusd-sandboxd.env' \
  '/etc/systemd/system/ynx-yusd-sandboxd.service'
do
  grep -Fq "$required" scripts/deploy/deploy-testnet.sh scripts/ops/backup.sh scripts/ops/rollback.sh ||
    { echo "full backup or rollback lifecycle missing YUSD path: $required"; exit 1; }
done

grep -Fq 'ynx-yusd-sandboxd' scripts/ops/lib.sh
bash scripts/deploy/check-local-services.sh --self-test
DEPLOY_DRY_RUN=1 bash scripts/deploy/deploy-yusd-sandbox.sh
echo "yusd-testnet-deploy-check passed: existing 1:1 Sandbox Runtime has scoped and full rollback-safe Testnet release lifecycles plus a real reserve-mint-redeem-fulfill proof"
