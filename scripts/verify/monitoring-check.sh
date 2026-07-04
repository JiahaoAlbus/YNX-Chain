#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

metrics="$(curl -fsS "$YNX_REST_URL/metrics")"
for required in \
  'ynx_chain_height{network="testnet",chain_id="6423",native_symbol="YNXT"}' \
  "ynx_chain_transactions_total" \
  "ynx_chain_validators" \
  "ynx_chain_pending_transactions" \
  "ynx_chain_persistence_error" \
  "ynx_resource_delegated_ynxt"
do
  if ! grep -Fq "$required" <<<"$metrics"; then
    echo "missing required metric: $required"
    exit 1
  fi
done

for file in infra/monitoring/prometheus.yml infra/monitoring/ynx-alerts.yml infra/monitoring/grafana-dashboard.json; do
  [[ -s "$file" ]] || { echo "missing monitoring file: $file"; exit 1; }
done

node -e 'JSON.parse(require("fs").readFileSync("infra/monitoring/grafana-dashboard.json","utf8")); console.log("grafana dashboard json ok")'
grep -Fq "ynx_explorer_sync_lag_blocks" infra/monitoring/grafana-dashboard.json
grep -Fq "metrics_path: /metrics" infra/monitoring/prometheus.yml
grep -Fq "YNXChainNoBlockProgress" infra/monitoring/ynx-alerts.yml
grep -Fq "ynx-indexerd:6426" infra/monitoring/prometheus.yml
grep -Fq "YNXIndexerLagging" infra/monitoring/ynx-alerts.yml
grep -Fq "ynx-explorerd:6427" infra/monitoring/prometheus.yml
grep -Fq "YNXExplorerLagging" infra/monitoring/ynx-alerts.yml
grep -Fq "ynx-faucetd:6428" infra/monitoring/prometheus.yml
grep -Fq "YNXFaucetDown" infra/monitoring/ynx-alerts.yml
grep -Fq "ynx_faucet_requests_total" infra/monitoring/grafana-dashboard.json
grep -Fq "prom/prometheus" infra/docker/docker-compose.yml
grep -Fq "grafana/grafana" infra/docker/docker-compose.yml
grep -Fq "MONITORING_ADMIN_PASSWORD" infra/docker/docker-compose.yml
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  MONITORING_ADMIN_PASSWORD=local-monitoring-check docker compose -f infra/docker/docker-compose.yml config >/dev/null
fi

echo "monitoring-check passed: /metrics, Prometheus config, alert rules, and Grafana dashboard are wired"
