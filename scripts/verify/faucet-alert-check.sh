#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

image="${YNX_PROMETHEUS_TEST_IMAGE:-prom/prometheus:v3.11.2}"
test_file="infra/monitoring/faucet-alerts.test.yml"

[[ -s infra/monitoring/ynx-alerts.yml ]] || { echo "missing alert rules"; exit 1; }
[[ -s "$test_file" ]] || { echo "missing Faucet alert tests"; exit 1; }

if command -v promtool >/dev/null 2>&1; then
  (cd infra/monitoring && promtool check rules ynx-alerts.yml && promtool test rules faucet-alerts.test.yml)
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker run --rm --entrypoint=promtool \
    -v "$PWD/infra/monitoring:/work:ro" \
    -w /work \
    "$image" check rules ynx-alerts.yml
  docker run --rm --entrypoint=promtool \
    -v "$PWD/infra/monitoring:/work:ro" \
    -w /work \
    "$image" test rules faucet-alerts.test.yml
else
  echo "faucet-alert-check requires promtool or a running Docker daemon" >&2
  exit 1
fi

echo "faucet-alert-check passed: stale, readiness, latency, admission, capacity, uncertain-result, and finite-balance alerts fire"
