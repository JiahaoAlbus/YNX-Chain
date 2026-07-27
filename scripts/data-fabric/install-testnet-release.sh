#!/usr/bin/env bash
set -euo pipefail

dry_run=0
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
  shift
fi

release_dir="${1:?usage: install-testnet-release.sh [--dry-run] <release-dir> <operator-env> <event-keys>}"
operator_env="${2:?missing operator environment file}"
event_keys="${3:?missing event key registry}"
manifest="$release_dir/release-manifest.json"

for tool in jq sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 1; }
done
[[ -d "$release_dir" && -r "$manifest" && -r "$operator_env" && -r "$event_keys" ]] || {
  echo "release directory, manifest, operator env, and event key registry must be readable" >&2
  exit 1
}

commit="$(jq -er '.commit | select(test("^[0-9a-f]{12}$"))' "$manifest")"
release="$(jq -er '.release' "$manifest")"
[[ "$release" == "ynx-data-fabric-${commit}" ]] || { echo "release identity is not commit-bound" >&2; exit 1; }
[[ "$(jq -er '.schema' "$manifest")" == "ynx-data-fabric-testnet-release/v1" ]] || { echo "release schema is invalid" >&2; exit 1; }
[[ "$(jq -er '.product' "$manifest")" == "ynx-data-fabric" ]] || { echo "release product is invalid" >&2; exit 1; }
[[ "$(jq -er '[.target.os, .target.architecture, .target.channel] | join("/")' "$manifest")" == "linux/amd64/testnet" ]] || { echo "release target is invalid" >&2; exit 1; }
[[ "$(jq -er '.sourceMode' "$manifest")" == "bft" ]] || { echo "release source mode is not BFT" >&2; exit 1; }
[[ "$(jq -r '.signing.productionSigned' "$manifest")" == "false" ]] || { echo "Testnet package signing truth is invalid" >&2; exit 1; }
[[ "$(jq -er '.artifacts | length' "$manifest")" == "12" ]] || { echo "release artifact inventory is incomplete" >&2; exit 1; }

required_artifacts=(
  bin/ynx-data-fabricctl
  bin/ynx-data-fabricd
  bin/ynx-data-fabric-worker
  bin/ynx-pay-data-fabric-bridge
  config/data-fabric.env
  config/event-keys.json
  scripts/install-testnet-release.sh
  scripts/remote-install-testnet-release.sh
  scripts/verify-testnet-deployment.sh
  systemd/ynx-data-fabricd.service
  systemd/ynx-data-fabric-worker.service
  systemd/ynx-pay-data-fabric-bridge.service
)
for required in "${required_artifacts[@]}"; do
  jq -e --arg path "$required" '.artifacts | any(.path == $path)' "$manifest" >/dev/null ||
    { echo "release artifact inventory is missing $required" >&2; exit 1; }
done

while IFS=$'\t' read -r relative_path expected_bytes expected_sha; do
  [[ "$relative_path" != /* && "$relative_path" != *..* ]] || { echo "release artifact path is unsafe" >&2; exit 1; }
  artifact="$release_dir/$relative_path"
  [[ -f "$artifact" ]] || { echo "release artifact is missing: $relative_path" >&2; exit 1; }
  [[ "$(wc -c < "$artifact" | tr -d ' ')" == "$expected_bytes" ]] || { echo "release artifact byte count mismatch: $relative_path" >&2; exit 1; }
  printf '%s  %s\n' "$expected_sha" "$artifact" | sha256sum -c - >/dev/null
done < <(jq -er '.artifacts[] | [.path, (.bytes|tostring), .sha256] | @tsv' "$manifest")

env_value() {
  local name="$1"
  awk -F= -v name="$name" '$1 == name { print substr($0, index($0, "=") + 1); found=1; exit } END { if (!found) exit 1 }' "$operator_env"
}

require_env() {
  local name="$1" value
  value="$(env_value "$name" 2>/dev/null || true)"
  [[ -n "$value" ]] || { echo "$name is required" >&2; exit 1; }
  printf '%s' "$value"
}

source_mode="$(require_env YNX_PAY_DATA_FABRIC_SOURCE_MODE)"
source_commit="$(require_env YNX_PAY_SOURCE_COMMIT)"
source_release="$(require_env YNX_PAY_SOURCE_RELEASE)"
fabric_commit="$(require_env YNX_DATA_FABRIC_SOURCE_COMMIT)"
fabric_release="$(require_env YNX_DATA_FABRIC_SOURCE_RELEASE)"
[[ "$source_mode" == "bft" ]] || { echo "Pay bridge source mode must equal bft" >&2; exit 1; }
[[ -z "$(env_value YNX_PAY_DATA_FABRIC_UPSTREAM_KEY_FILE 2>/dev/null || true)" ]] || { echo "BFT Pay bridge must not configure a legacy upstream key" >&2; exit 1; }
[[ "$source_commit" == "$commit" && "$source_release" == "ynx-bft-gateway-${commit}" ]] || { echo "BFT source identity does not match the release commit" >&2; exit 1; }
[[ "$fabric_commit" == "$commit" && "$fabric_release" == "$release" ]] || { echo "Data Fabric identity does not match the release manifest" >&2; exit 1; }
[[ "$(require_env YNX_PAY_DATA_FABRIC_CHAIN_ID)" == "6423" ]] || { echo "Pay bridge chain ID must equal 6423" >&2; exit 1; }
[[ "$(require_env YNX_DATA_FABRIC_STORE)" == "postgres" && "$(require_env YNX_DATA_FABRIC_BROKER)" == "nats" ]] || { echo "Testnet Data Fabric requires PostgreSQL and NATS" >&2; exit 1; }
[[ "$(require_env YNX_DATA_FABRIC_PAY_LEDGER_ENABLED)" == "true" ]] || { echo "Testnet Pay Ledger reconciliation must be enabled" >&2; exit 1; }
[[ "$(require_env YNX_DATA_FABRIC_EVENT_KEYS_FILE)" == "/etc/ynx-data-fabric/event-keys.json" ]] || { echo "event key registry path must match the installed registry" >&2; exit 1; }
[[ "$(require_env YNX_DATA_FABRIC_NATS_URL)" == tls://* ]] || { echo "Data Fabric NATS URL must use TLS" >&2; exit 1; }
for name in YNX_PAY_DATA_FABRIC_SOURCE_URL YNX_PAY_DATA_FABRIC_URL; do
  value="$(require_env "$name")"
  [[ "$value" == https://* || "$value" == http://127.0.0.1:* ]] || { echo "$name must use HTTPS or loopback HTTP" >&2; exit 1; }
done
require_env YNX_PAY_DATA_FABRIC_EVENT_KEY_ID >/dev/null
[[ "$(require_env YNX_DATA_FABRIC_PAY_CHAIN_URL)" == "$(require_env YNX_PAY_DATA_FABRIC_SOURCE_URL)" ]] || { echo "Pay Ledger observer and producer must use the same BFT source" >&2; exit 1; }
[[ "$(require_env YNX_DATA_FABRIC_PAY_CHAIN_COMMIT)" == "$source_commit" && "$(require_env YNX_DATA_FABRIC_PAY_CHAIN_RELEASE)" == "$source_release" ]] || { echo "Pay Ledger observer identity does not match the BFT source" >&2; exit 1; }

private_paths=(
  YNX_DATA_FABRIC_POSTGRES_DSN_FILE
  YNX_DATA_FABRIC_NATS_CREDENTIALS_FILE
  YNX_DATA_FABRIC_NATS_KEY_FILE
  YNX_DATA_FABRIC_PRIVACY_KEY_FILE
  YNX_PAY_DATA_FABRIC_EVENT_KEY_FILE
)
public_paths=(
  YNX_DATA_FABRIC_NATS_CA_FILE
  YNX_DATA_FABRIC_NATS_CERT_FILE
)
for name in "${private_paths[@]}" "${public_paths[@]}"; do
  value="$(require_env "$name")"
  [[ "$value" == /* ]] || { echo "$name must be an absolute path" >&2; exit 1; }
  if [[ "$dry_run" != "1" ]]; then
    [[ -r "$value" ]] || { echo "$name is not readable" >&2; exit 1; }
  fi
done

if [[ "$dry_run" == "1" ]]; then
  printf 'validated install plan release=%s commit=%s services=ynx-data-fabricd,ynx-data-fabric-worker,ynx-pay-data-fabric-bridge\n' "$release" "$commit"
  exit 0
fi

[[ "$(id -u)" == "0" ]] || { echo "installation requires root" >&2; exit 1; }
id -u ynx-data-fabric >/dev/null 2>&1 || useradd --system --home /var/lib/ynx-data-fabric --shell /usr/sbin/nologin ynx-data-fabric
install -d -m 0750 -o ynx-data-fabric -g ynx-data-fabric /etc/ynx-data-fabric /var/lib/ynx-data-fabric /var/log/ynx-data-fabric
for command in ynx-data-fabricctl ynx-data-fabricd ynx-data-fabric-worker ynx-pay-data-fabric-bridge; do
  install -m 0755 -o root -g root "$release_dir/bin/$command" "/usr/local/bin/$command"
done
install -m 0640 -o root -g ynx-data-fabric "$operator_env" /etc/ynx-data-fabric/data-fabric.env
install -m 0600 -o ynx-data-fabric -g ynx-data-fabric "$event_keys" /etc/ynx-data-fabric/event-keys.json
for unit in "$release_dir"/systemd/*.service; do
  install -m 0644 -o root -g root "$unit" "/etc/systemd/system/$(basename "$unit")"
done

for name in "${private_paths[@]}" "${public_paths[@]}"; do
  value="$(require_env "$name")"
  runuser -u ynx-data-fabric -- test -r "$value" || { echo "$name is not readable by ynx-data-fabric" >&2; exit 1; }
done
while IFS= read -r key_file; do
  [[ "$key_file" == /* ]] || { echo "event signing key path must be absolute" >&2; exit 1; }
  runuser -u ynx-data-fabric -- test -r "$key_file" || { echo "event signing key is not readable by ynx-data-fabric" >&2; exit 1; }
done < <(jq -er '.keys[] | .keyFile' "$event_keys")

dsn_file="$(require_env YNX_DATA_FABRIC_POSTGRES_DSN_FILE)"
/usr/local/bin/ynx-data-fabricctl migrate-postgres --dsn-file "$dsn_file"
systemctl daemon-reload
systemctl enable ynx-data-fabricd.service ynx-data-fabric-worker.service ynx-pay-data-fabric-bridge.service
systemctl restart ynx-data-fabricd.service
systemctl restart ynx-data-fabric-worker.service
systemctl restart ynx-pay-data-fabric-bridge.service
systemctl --no-pager --full status ynx-data-fabricd.service ynx-data-fabric-worker.service ynx-pay-data-fabric-bridge.service
