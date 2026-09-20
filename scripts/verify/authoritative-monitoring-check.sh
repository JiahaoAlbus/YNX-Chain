#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

config=infra/monitoring/prometheus-authoritative.yml
unit=infra/monitoring/systemd/ynx-prometheus.service

for file in "$config" "$unit" infra/monitoring/ynx-alerts.yml; do
  [[ -s "$file" ]] || { echo "missing authoritative monitoring file: $file"; exit 1; }
done

for target in 127.0.0.1:6420 10.77.42.2:6420 10.77.42.3:6420 10.77.42.4:6420; do
  [[ "$(grep -Fc -- "- $target" "$config")" == "1" ]] || { echo "authoritative target must occur exactly once: $target"; exit 1; }
done

[[ "$(grep -Fc -- '- 127.0.0.1:6428' "$config")" == "1" ]] || { echo "authoritative Faucet target must occur exactly once"; exit 1; }
grep -A8 -F 'job_name: ynx-faucetd' "$config" | grep -Fq 'service: ynx-faucetd' || { echo "authoritative Faucet scrape labels are missing"; exit 1; }

for role in primary singapore silicon-valley seoul; do
  grep -Fq "role: $role" "$config" || { echo "missing authoritative role label: $role"; exit 1; }
done

if grep -Eq '43\.[0-9]+\.[0-9]+\.[0-9]+' "$config"; then
  echo "authoritative monitoring config must not scrape public node addresses"
  exit 1
fi

grep -Fq -- '--web.listen-address=10.77.42.1:19090' "$unit"
grep -Fq 'User=ynx-prometheus' "$unit"
grep -Fq 'SupplementaryGroups=ynx' "$unit"
grep -Fq 'NoNewPrivileges=true' "$unit"
grep -Fq 'ProtectSystem=strict' "$unit"

if command -v promtool >/dev/null 2>&1; then
  rendered="$(mktemp)"
  trap 'rm -f "$rendered"' EXIT
  sed "s#/etc/ynx/prometheus/ynx-alerts.yml#$PWD/infra/monitoring/ynx-alerts.yml#" "$config" >"$rendered"
  promtool check config "$rendered"
  promtool check rules infra/monitoring/ynx-alerts.yml
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker run --rm \
    -v "$PWD/infra/monitoring:/work:ro" \
    -v "$PWD/infra/monitoring/ynx-alerts.yml:/etc/ynx/prometheus/ynx-alerts.yml:ro" \
    --entrypoint /bin/promtool \
    prom/prometheus:v3.11.2 check config /work/prometheus-authoritative.yml
fi

echo "authoritative-monitoring-check passed: four distinct chain targets, primary Faucet scrape, and restricted listener are configured"
