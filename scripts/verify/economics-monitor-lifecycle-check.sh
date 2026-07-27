#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

bash -n scripts/deploy/deploy-testnet.sh scripts/deploy/dry-run.sh scripts/deploy/check-local-services.sh \
  scripts/ops/backup.sh scripts/ops/rollback.sh scripts/ops/lib.sh
node --check scripts/deploy/write-release-manifest.mjs
node --check scripts/verify/release-manifest-check.mjs

for required in \
  'bin/ynx-economics-monitord' \
  'config/ynx-economics-monitord.env' \
  'systemd/ynx-economics-monitord.service'
do
  grep -Fq "$required" scripts/deploy/write-release-manifest.mjs scripts/verify/release-manifest-check.mjs \
    scripts/deploy/dry-run.sh || { echo "release lifecycle missing Economics Monitor artifact: $required"; exit 1; }
done

for required in \
  '/etc/ynx/ynx-economics-monitord.env' \
  '/etc/systemd/system/ynx-economics-monitord.service'
do
  grep -Fq "$required" scripts/deploy/deploy-testnet.sh scripts/ops/backup.sh scripts/ops/rollback.sh ||
    { echo "backup or rollback lifecycle missing Economics Monitor path: $required"; exit 1; }
done

for required in \
  'YNX_STABLE_RESERVE_ADAPTER_RELEASE_CLASS=public_testnet' \
  'YNX_PUBLIC_STABLE_RESERVE_URL=https://${EXPLORER_DOMAIN}/api/stable/reserve' \
  'YNX_YUSD_SANDBOX_URL=http://127.0.0.1:6490' \
  'YNX_PUBLIC_YUSD_SANDBOX_URL=https://${EXPLORER_DOMAIN}/api/stable/yusd-sandbox' \
  'ynx-economics-monitord --check-config' \
  'systemctl restart ynx-economics-monitord'
do
  grep -Fq "$required" scripts/deploy/deploy-testnet.sh ||
    { echo "full Testnet deploy missing Economics Monitor gate: $required"; exit 1; }
done

grep -Fq 'ynx-economics-monitord' scripts/ops/lib.sh
bash scripts/deploy/check-local-services.sh --self-test
echo "economics-monitor-lifecycle-check passed: full bundle, health, backup and rollback boundaries include the public monitor"
