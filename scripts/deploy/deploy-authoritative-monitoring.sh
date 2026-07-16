#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh
ynx_load_env

PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-43.153.202.237}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-ubuntu}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"
PROMETHEUS_VERSION=3.11.2
PROMETHEUS_ARCHIVE="prometheus-${PROMETHEUS_VERSION}.linux-amd64.tar.gz"
PROMETHEUS_ARCHIVE_SHA256=f643ea1ee90d109329302d27bddb1fb2e52655b1fa84e9e26f9a6f340da144a6
PROMETHEUS_URL="https://github.com/prometheus/prometheus/releases/download/v${PROMETHEUS_VERSION}/${PROMETHEUS_ARCHIVE}"
PROMETHEUS_ARCHIVE_PATH="${YNX_PROMETHEUS_ARCHIVE_PATH:-}"

[[ -r "$PRIMARY_NODE_SSH_KEY" ]] || { echo "primary SSH key is not readable"; exit 1; }
ynx_require_clean_worktree
bash scripts/verify/authoritative-monitoring-check.sh

work="$(mktemp -d)"
remote_work="/tmp/ynx-prometheus-install-$$"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

binary_sha=""
promtool_sha=""
if [[ -n "$PROMETHEUS_ARCHIVE_PATH" ]]; then
  [[ -f "$PROMETHEUS_ARCHIVE_PATH" && ! -L "$PROMETHEUS_ARCHIVE_PATH" ]] || { echo "Prometheus archive cache must be a regular file"; exit 1; }
  cp "$PROMETHEUS_ARCHIVE_PATH" "$work/$PROMETHEUS_ARCHIVE"
  printf '%s  %s\n' "$PROMETHEUS_ARCHIVE_SHA256" "$work/$PROMETHEUS_ARCHIVE" | shasum -a 256 -c -
  tar -xzf "$work/$PROMETHEUS_ARCHIVE" -C "$work"
  binary="$work/prometheus-${PROMETHEUS_VERSION}.linux-amd64/prometheus"
  promtool="$work/prometheus-${PROMETHEUS_VERSION}.linux-amd64/promtool"
  [[ -x "$binary" && -x "$promtool" ]] || { echo "Prometheus archive is missing required binaries"; exit 1; }
  binary_sha="$(shasum -a 256 "$binary" | awk '{print $1}')"
  promtool_sha="$(shasum -a 256 "$promtool" | awk '{print $1}')"
fi

remote="${PRIMARY_NODE_USER}@${PRIMARY_NODE_HOST}"
ynx_transport_ssh monitoring-mkdir "$PRIMARY_NODE_SSH_KEY" "$remote" "umask 077 && mkdir -p '$remote_work'"
if [[ -n "$PROMETHEUS_ARCHIVE_PATH" ]]; then
  ynx_transport_scp monitoring-binary "$PRIMARY_NODE_SSH_KEY" "$binary" "$remote" "$remote_work/ynx-prometheus"
  ynx_transport_scp monitoring-promtool "$PRIMARY_NODE_SSH_KEY" "$promtool" "$remote" "$remote_work/promtool"
fi
ynx_transport_scp monitoring-config "$PRIMARY_NODE_SSH_KEY" infra/monitoring/prometheus-authoritative.yml "$remote" "$remote_work/prometheus.yml"
ynx_transport_scp monitoring-rules "$PRIMARY_NODE_SSH_KEY" infra/monitoring/ynx-alerts.yml "$remote" "$remote_work/ynx-alerts.yml"
ynx_transport_scp monitoring-unit "$PRIMARY_NODE_SSH_KEY" infra/monitoring/systemd/ynx-prometheus.service "$remote" "$remote_work/ynx-prometheus.service"

ynx_transport_ssh monitoring-install "$PRIMARY_NODE_SSH_KEY" "$remote" \
  "YNX_MONITORING_REMOTE_WORK='$remote_work' YNX_MONITORING_VERSION='$PROMETHEUS_VERSION' YNX_MONITORING_ARCHIVE='$PROMETHEUS_ARCHIVE' YNX_MONITORING_ARCHIVE_SHA='$PROMETHEUS_ARCHIVE_SHA256' YNX_MONITORING_URL='$PROMETHEUS_URL' YNX_MONITORING_BINARY_SHA='$binary_sha' YNX_MONITORING_PROMTOOL_SHA='$promtool_sha' bash -s" <<'REMOTE'
set -euo pipefail
work="${YNX_MONITORING_REMOTE_WORK:?}"
version="${YNX_MONITORING_VERSION:?}"
archive="${YNX_MONITORING_ARCHIVE:?}"
archive_sha="${YNX_MONITORING_ARCHIVE_SHA:?}"
trap 'rm -rf "$work"' EXIT
if [[ -x "$work/ynx-prometheus" && -x "$work/promtool" ]]; then
  [[ "$(sha256sum "$work/ynx-prometheus" | awk '{print $1}')" == "${YNX_MONITORING_BINARY_SHA:?}" ]] || { echo "remote Prometheus binary checksum mismatch"; exit 1; }
  [[ "$(sha256sum "$work/promtool" | awk '{print $1}')" == "${YNX_MONITORING_PROMTOOL_SHA:?}" ]] || { echo "remote promtool checksum mismatch"; exit 1; }
else
  curl --fail --location --silent --show-error --max-time 900 \
    --continue-at - --retry 4 --retry-all-errors --retry-delay 3 \
    "${YNX_MONITORING_URL:?}" -o "$work/$archive"
  printf '%s  %s\n' "$archive_sha" "$work/$archive" | sha256sum -c -
  tar -xzf "$work/$archive" -C "$work"
  install -m 0755 "$work/prometheus-${version}.linux-amd64/prometheus" "$work/ynx-prometheus"
  install -m 0755 "$work/prometheus-${version}.linux-amd64/promtool" "$work/promtool"
fi
"$work/ynx-prometheus" --version 2>&1 | grep -Fq "version $version" || { echo "remote Prometheus version mismatch"; exit 1; }
sed "s#/etc/ynx/prometheus/ynx-alerts.yml#$work/ynx-alerts.yml#" "$work/prometheus.yml" >"$work/prometheus-check.yml"
"$work/promtool" check config "$work/prometheus-check.yml"
"$work/promtool" check rules "$work/ynx-alerts.yml"
ip -4 address show dev ynxwg0 | grep -Fq '10.77.42.1/32' || { echo "primary WireGuard monitoring address is absent"; exit 1; }
for target in 10.77.42.2 10.77.42.3 10.77.42.4; do
  curl -fsS --max-time 8 --retry 3 --retry-all-errors --retry-delay 2 \
    "http://$target:6420/metrics" >/dev/null || { echo "WireGuard metrics target unavailable after bounded retries: $target"; exit 1; }
done
if ! id -u ynx-prometheus >/dev/null 2>&1; then
  sudo -n useradd --system --home-dir /var/lib/ynx-prometheus --shell /usr/sbin/nologin ynx-prometheus
fi
sudo -n install -d -o ynx-prometheus -g ynx-prometheus -m 0750 /var/lib/ynx-prometheus
sudo -n install -d -o root -g ynx-prometheus -m 0750 /etc/ynx/prometheus
sudo -n install -o root -g root -m 0755 "$work/ynx-prometheus" /usr/local/bin/ynx-prometheus
sudo -n install -o root -g ynx-prometheus -m 0640 "$work/prometheus.yml" /etc/ynx/prometheus/prometheus.yml
sudo -n install -o root -g ynx-prometheus -m 0640 "$work/ynx-alerts.yml" /etc/ynx/prometheus/ynx-alerts.yml
sudo -n install -o root -g root -m 0644 "$work/ynx-prometheus.service" /etc/systemd/system/ynx-prometheus.service
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now ynx-prometheus.service
REMOTE

for attempt in $(seq 1 12); do
  if evidence="$(ynx_transport_ssh monitoring-ready "$PRIMARY_NODE_SSH_KEY" "$remote" \
    "curl -fsS --max-time 5 'http://10.77.42.1:19090/api/v1/query?query=up%7Bjob%3D%22ynx-chaind%22%7D'")" && \
    node -e 'const d=JSON.parse(process.argv[1]); const r=d?.data?.result||[]; if(r.length!==4||r.some(x=>x.value?.[1]!=="1"))process.exit(1)' "$evidence"; then
    printf '%s\n' "$evidence"
    echo "authoritative monitoring deployed: four exact Prometheus targets are up through loopback/WireGuard"
    exit 0
  fi
  sleep 5
done

echo "authoritative monitoring failed to prove four healthy targets" >&2
exit 1
