#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh
ynx_load_env

ynx_require_env SERVER_HOST SERVER_USER SSH_KEY_PATH
ynx_reject_unsafe_env_values SERVER_HOST SERVER_USER SSH_KEY_PATH
[[ -f "$SSH_KEY_PATH" && ! -L "$SSH_KEY_PATH" ]] || {
  echo "SSH_KEY_PATH must be a regular non-symlink file" >&2
  exit 1
}
if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
  ynx_require_clean_worktree
fi

rules="config/oracle/monitoring/oracle-alerts.yml"
scrape="config/oracle/monitoring/prometheus-scrape.yml"
tests="config/oracle/monitoring/oracle-alerts.test.yml"
for file in "$rules" "$scrape" "$tests"; do
  [[ -s "$file" && ! -L "$file" ]] || {
    echo "Oracle monitoring input must be a regular non-symlink file: $file" >&2
    exit 1
  }
done
grep -Fq 'alert: YNXOracleMetricsDown' "$rules"
grep -Fq 'alert: YNXOracleInsufficientSources' "$rules"
grep -Fq 'alert: YNXOracleEmergencyPaused' "$rules"
[[ "$(grep -Fc 'job_name: ynx-oracled' "$scrape")" == "1" ]]
grep -Fq -- '- 127.0.0.1:9470' "$scrape"

commit="$(git rev-parse HEAD)"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]]
remote="$(ynx_remote)"
remote_work="/tmp/ynx-oracle-monitor-${commit}"
prometheus_version=3.11.2
archive="prometheus-${prometheus_version}.linux-amd64.tar.gz"
archive_sha=f643ea1ee90d109329302d27bddb1fb2e52655b1fa84e9e26f9a6f340da144a6
archive_url="https://github.com/prometheus/prometheus/releases/download/v${prometheus_version}/${archive}"
promtool_sha=5bcba125705573e869f2eea1d1ffaf15225a8791745b17d62cbf59600d00530c

ynx_ssh "set -e; umask 077; mkdir -p '$remote_work'"
ynx_scp "$rules" "$remote_work/oracle-alerts.yml"
ynx_scp "$scrape" "$remote_work/prometheus-scrape.yml"
ynx_scp "$tests" "$remote_work/oracle-alerts.test.yml"

if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  ynx_ssh "oracle monitoring remote merge and validation commit='$commit'"
  printf 'Oracle monitoring deployment dry run passed: commit=%s\n' "$commit"
  exit 0
fi

ynx_transport_ssh "oracle-monitor-install" "$SSH_KEY_PATH" "$remote" \
  "YNX_ORACLE_MONITOR_WORK='$remote_work' YNX_ORACLE_MONITOR_COMMIT='$commit' YNX_PROMETHEUS_VERSION='$prometheus_version' YNX_PROMETHEUS_ARCHIVE='$archive' YNX_PROMETHEUS_ARCHIVE_SHA='$archive_sha' YNX_PROMETHEUS_URL='$archive_url' YNX_PROMTOOL_SHA='$promtool_sha' bash -s" <<'REMOTE'
set -euo pipefail
work="${YNX_ORACLE_MONITOR_WORK:?}"
commit="${YNX_ORACLE_MONITOR_COMMIT:?}"
config=/etc/ynx/prometheus/prometheus.yml
rules=/etc/ynx/prometheus/oracle-alerts.yml
promtool=/usr/local/bin/ynx-promtool

sudo test -f "$config"
sudo test ! -L "$config"
sudo test -f /etc/ynx/prometheus/ynx-alerts.yml
systemctl is-active --quiet ynx-prometheus.service
curl -fsS --max-time 5 http://127.0.0.1:9470/metrics |
  grep -Fq 'ynx_oracle_health_degraded '

if [[ ! -x "$promtool" ]] || [[ "$(sha256sum "$promtool" | awk '{print $1}')" != "${YNX_PROMTOOL_SHA:?}" ]]; then
  curl --fail --location --silent --show-error --max-time 900 \
    --retry 4 --retry-all-errors --retry-delay 3 \
    "${YNX_PROMETHEUS_URL:?}" -o "$work/${YNX_PROMETHEUS_ARCHIVE:?}"
  printf '%s  %s\n' "${YNX_PROMETHEUS_ARCHIVE_SHA:?}" "$work/${YNX_PROMETHEUS_ARCHIVE:?}" | sha256sum -c -
  tar -xzf "$work/${YNX_PROMETHEUS_ARCHIVE:?}" -C "$work"
  candidate="$work/prometheus-${YNX_PROMETHEUS_VERSION:?}.linux-amd64/promtool"
  [[ "$(sha256sum "$candidate" | awk '{print $1}')" == "${YNX_PROMTOOL_SHA:?}" ]]
  sudo install -o root -g root -m 0755 "$candidate" "$promtool"
fi

if sudo grep -Fq 'job_name: ynx-oracled' "$config"; then
  [[ "$(sudo grep -Fc 'job_name: ynx-oracled' "$config")" == "1" ]]
  sudo grep -Fq -- '- 127.0.0.1:9470' "$config"
  sudo cp "$config" "$work/prometheus.yml"
  sudo chown "$(id -u):$(id -g)" "$work/prometheus.yml"
else
  sudo awk -v fragment="$work/prometheus-scrape.yml" '
    BEGIN { inserted = 0 }
    $0 == "scrape_configs:" {
      print
      while ((getline line < fragment) > 0) print "  " line
      close(fragment)
      inserted = 1
      next
    }
    { print }
    END {
      if (!inserted) exit 42
    }
  ' "$config" >"$work/prometheus.yml"
fi

if grep -Fq '/etc/ynx/prometheus/oracle-alerts.yml' "$work/prometheus.yml"; then
  [[ "$(grep -Fc '/etc/ynx/prometheus/oracle-alerts.yml' "$work/prometheus.yml")" == "1" ]]
  cp "$work/prometheus.yml" "$work/prometheus-with-rules.yml"
else
  awk '
    BEGIN { inserted = 0 }
    $0 == "rule_files:" {
      print
      print "  - /etc/ynx/prometheus/oracle-alerts.yml"
      inserted = 1
      next
    }
    { print }
    END {
      if (!inserted) exit 42
    }
  ' "$work/prometheus.yml" >"$work/prometheus-with-rules.yml"
fi

"$promtool" check rules "$work/oracle-alerts.yml"
(
  cd "$work"
  "$promtool" test rules oracle-alerts.test.yml
)
sed "s#/etc/ynx/prometheus/oracle-alerts.yml#$work/oracle-alerts.yml#" \
  "$work/prometheus-with-rules.yml" >"$work/prometheus-check.yml"
"$promtool" check config "$work/prometheus-check.yml"
sudo install -o root -g ynx-prometheus -m 0640 "$work/oracle-alerts.yml" "$rules"
sudo install -d -o root -g ynx-prometheus -m 0750 /var/lib/ynx-prometheus/config-backups
sudo install -o root -g ynx-prometheus -m 0640 "$config" \
  "/var/lib/ynx-prometheus/config-backups/prometheus-before-oracle-${commit}.yml"
sudo install -o root -g ynx-prometheus -m 0640 "$work/prometheus-with-rules.yml" "$config"
sudo systemctl restart ynx-prometheus.service
REMOTE

for attempt in $(seq 1 12); do
  if evidence="$(ynx_ssh "curl -fsS --max-time 5 'http://10.77.42.1:19090/api/v1/query?query=up%7Bjob%3D%22ynx-oracled%22%7D'")" &&
    jq -e '.status == "success" and (.data.result | length) == 1 and .data.result[0].value[1] == "1"' <<<"$evidence" >/dev/null; then
    printf '%s\n' "$evidence"
    printf 'Oracle monitoring deployed: commit=%s target=127.0.0.1:9470 status=up\n' "$commit"
    exit 0
  fi
  sleep 5
done

echo "Oracle monitoring failed to prove one healthy loopback scrape target" >&2
exit 1
