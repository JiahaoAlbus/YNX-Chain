#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test -race ./internal/publicprobe ./cmd/ynx-economics-monitord
go vet ./internal/publicprobe ./cmd/ynx-economics-monitord
bash -n scripts/deploy/deploy-economics-monitor.sh scripts/deploy/remote/install-economics-monitor.sh

for required in \
  YNX_PUBLIC_STABLE_RESERVE_URL \
  YNX_ECONOMICS_MONITOR_HTTP_ADDR \
  ynx-economics-monitord.service \
  ynx_public_stable_reserve_probe_success \
  scoped\ Economics\ Monitor\ deployment\ verified
do
  grep -Fq "$required" scripts/deploy/deploy-economics-monitor.sh scripts/deploy/remote/install-economics-monitor.sh \
    infra/monitoring/systemd/ynx-economics-monitord.service internal/publicprobe/monitor.go ||
    { echo "missing Economics Monitor deployment gate: $required"; exit 1; }
done

DEPLOY_DRY_RUN=1 EXPLORER_DOMAIN=explorer.testnet.ynx.invalid bash scripts/deploy/deploy-economics-monitor.sh
echo "economics-monitor-check passed: fail-closed public probe runtime and scoped deployment are verified"
