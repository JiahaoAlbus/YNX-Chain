#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

rules=infra/monitoring/ynx-alerts.yml
tests=infra/monitoring/stable-reserve-alerts.test.yml

[[ -s "$rules" && -s "$tests" ]] || { echo "stable reserve alert rules or tests are missing"; exit 1; }
for alert in YNXStableReserveProviderUnavailable YNXStableReserveShortfall YNXStableReserveAttestationExpiring; do
  grep -Fq "$alert" "$rules" || { echo "missing stable reserve alert: $alert"; exit 1; }
  grep -Fq "$alert" "$tests" || { echo "missing stable reserve alert test: $alert"; exit 1; }
done

if command -v promtool >/dev/null 2>&1; then
  (cd infra/monitoring && promtool check rules ynx-alerts.yml && promtool test rules stable-reserve-alerts.test.yml)
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  image="${YNX_PROMETHEUS_IMAGE:-prom/prometheus:v3.11.2}"
  docker run --rm -v "$PWD/infra/monitoring:/work:ro" --entrypoint /bin/promtool \
    "$image" check rules /work/ynx-alerts.yml
  docker run --rm -v "$PWD/infra/monitoring:/work:ro" --entrypoint /bin/promtool \
    "$image" test rules /work/stable-reserve-alerts.test.yml
else
  echo "stable-reserve-alert-check requires promtool or a running Docker daemon" >&2
  exit 1
fi

echo "stable-reserve-alert-check passed: unavailable, shortfall and expiry alerts fire and clear"
