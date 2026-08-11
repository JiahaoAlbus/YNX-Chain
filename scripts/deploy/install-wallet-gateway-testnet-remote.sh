#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?missing extracted release directory}"
source_commit="${2:?missing full source commit}"
release="${3:?missing release name}"
build_time="${4:?missing canonical build time}"
registry_file_sha="${5:?missing registry file digest}"
registry_runtime_sha="${6:?missing registry runtime digest}"

[[ "$(id -u)" == "0" ]] || { echo "Wallet Gateway installer must run as root" >&2; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "source commit must be a full lowercase Git SHA" >&2; exit 1; }
[[ "$release" == "ynx-wallet-gateway-${source_commit:0:12}" ]] || { echo "release does not match source commit" >&2; exit 1; }
[[ "$build_time" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] || { echo "build time must be canonical UTC" >&2; exit 1; }
[[ "$registry_file_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "registry file digest is invalid" >&2; exit 1; }
[[ "$registry_runtime_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "registry runtime digest is invalid" >&2; exit 1; }
[[ -d "$release_dir" && ! -L "$release_dir" ]] || { echo "release directory is missing or unsafe" >&2; exit 1; }
command -v curl >/dev/null
command -v node >/dev/null
command -v runuser >/dev/null
command -v sha256sum >/dev/null
command -v systemctl >/dev/null
id -u ynx >/dev/null
(
  cd "$release_dir"
  sha256sum -c SHA256SUMS
)
printf '%s  %s\n' "$registry_file_sha" "$release_dir/wallet-auth/central-registry.json" | sha256sum -c -

unit=/etc/systemd/system/ynx-wallet-gatewayd.service
env_file=/etc/ynx/ynx-wallet-gatewayd.env
state_dir=/var/lib/ynx-chain/wallet-gateway
state_file="$state_dir/state.json"
[[ -s "$unit" && ! -L "$unit" ]] || { echo "current Wallet Gateway unit is missing or unsafe" >&2; exit 1; }
[[ -s "$env_file" && ! -L "$env_file" ]] || { echo "current Wallet Gateway env is missing or unsafe" >&2; exit 1; }
[[ -s "$state_file" && ! -L "$state_file" ]] || { echo "current Wallet Gateway state is missing or unsafe" >&2; exit 1; }
[[ "$(stat -c '%a' "$state_dir")" == "700" ]] || { echo "Wallet Gateway state directory must be mode 0700" >&2; exit 1; }

umask 077
preflight_state="$state_dir/.preflight-$release.json"
preflight_log="$state_dir/.preflight-$release.log"
cp -a "$state_file" "$preflight_state"
chown ynx:ynx "$preflight_state"
chmod 0600 "$preflight_state"
runuser -u ynx -- env \
  YNX_WALLET_GATEWAY_HTTP_ADDR=127.0.0.1 \
  YNX_WALLET_GATEWAY_HTTP_PORT=17439 \
  YNX_WALLET_GATEWAY_STATE_PATH="$preflight_state" \
  YNX_WALLET_GATEWAY_REGISTRY_PATH="$release_dir/wallet-auth/central-registry.json" \
  YNX_WALLET_GATEWAY_REMOTE_DEPLOYED=true \
  YNX_WALLET_GATEWAY_SOURCE_COMMIT="$source_commit" \
  YNX_WALLET_GATEWAY_RELEASE="$release" \
  YNX_WALLET_GATEWAY_BUILD_TIME="$build_time" \
  node "$release_dir/wallet-auth/scripts/ynx-wallet-gatewayd.mjs" >"$preflight_log" 2>&1 &
preflight_pid=$!
cleanup_preflight() {
  kill "$preflight_pid" 2>/dev/null || true
  wait "$preflight_pid" 2>/dev/null || true
  rm -f "$preflight_state" "$preflight_log"
}
trap cleanup_preflight EXIT
preflight_ok=0
for attempt in $(seq 1 20); do
  if version_json="$(curl -fsS --max-time 3 http://127.0.0.1:17439/version)" && \
    VERSION_JSON="$version_json" EXPECTED_COMMIT="$source_commit" EXPECTED_RELEASE="$release" EXPECTED_REGISTRY="$registry_runtime_sha" node <<'NODE'
const value=JSON.parse(process.env.VERSION_JSON);
if(!value.ok||value.service!=="ynx-wallet-gatewayd"||value.build?.sourceCommit!==process.env.EXPECTED_COMMIT||value.build?.release!==process.env.EXPECTED_RELEASE||value.registrySha256!==process.env.EXPECTED_REGISTRY||!value.enabledProductClientIds?.includes("ynx-bridge-web-v1")||!value.enabledProductClientIds?.includes("ynx-creator-studio-web-v1")||!value.enabledProductClientIds?.includes("ynx-dex-web-v1"))process.exit(1);
NODE
  then
    preflight_ok=1
    break
  fi
  sleep 1
done
[[ "$preflight_ok" == "1" ]] || { echo "candidate Wallet Gateway failed state-migration preflight" >&2; exit 1; }
cleanup_preflight
trap - EXIT

backup_dir="/var/backups/ynx-chain/wallet-gateway-predeploy-$release"
install -d -m 0700 "$backup_dir"
cp -a "$unit" "$backup_dir/ynx-wallet-gatewayd.service"
cp -a "$env_file" "$backup_dir/ynx-wallet-gatewayd.env"
cp -a "$state_file" "$backup_dir/state.json"
new_unit="/etc/systemd/system/.ynx-wallet-gatewayd.service.$release"
new_env="/etc/ynx/.ynx-wallet-gatewayd.env.$release"
awk -v exec="ExecStart=/usr/bin/env node $release_dir/wallet-auth/scripts/ynx-wallet-gatewayd.mjs" '/^ExecStart=/{print exec; next}{print}' "$unit" >"$new_unit"
awk '!/^YNX_WALLET_GATEWAY_REGISTRY_PATH=/ && !/^YNX_WALLET_GATEWAY_SOURCE_COMMIT=/ && !/^YNX_WALLET_GATEWAY_RELEASE=/ && !/^YNX_WALLET_GATEWAY_BUILD_TIME=/' "$env_file" >"$new_env"
cat >>"$new_env" <<EOF
YNX_WALLET_GATEWAY_REGISTRY_PATH=$release_dir/wallet-auth/central-registry.json
YNX_WALLET_GATEWAY_SOURCE_COMMIT=$source_commit
YNX_WALLET_GATEWAY_RELEASE=$release
YNX_WALLET_GATEWAY_BUILD_TIME=$build_time
EOF
chmod 0644 "$new_unit"
chmod 0600 "$new_env"
grep -Fxq "ExecStart=/usr/bin/env node $release_dir/wallet-auth/scripts/ynx-wallet-gatewayd.mjs" "$new_unit"
grep -Fxq "YNX_WALLET_GATEWAY_REGISTRY_PATH=$release_dir/wallet-auth/central-registry.json" "$new_env"

rollback_required=1
rollback() {
  exit_code=$?
  trap - EXIT
  if [[ "$rollback_required" == "1" ]]; then
    echo "Wallet Gateway install failed; restoring prior unit, env and state" >&2
    install -m 0644 "$backup_dir/ynx-wallet-gatewayd.service" "$unit"
    install -m 0600 "$backup_dir/ynx-wallet-gatewayd.env" "$env_file"
    install -m 0600 -o ynx -g ynx "$backup_dir/state.json" "$state_file"
    rm -f "$new_unit" "$new_env"
    systemctl daemon-reload || true
    systemctl restart ynx-wallet-gatewayd || true
  fi
  exit "$exit_code"
}
trap rollback EXIT
install -m 0644 "$new_unit" "$unit"
install -m 0600 "$new_env" "$env_file"
rm -f "$new_unit" "$new_env"
systemctl daemon-reload
systemctl restart ynx-wallet-gatewayd

runtime_ok=0
for attempt in $(seq 1 30); do
  if health_json="$(curl -fsS --max-time 3 http://127.0.0.1:6439/health)" && \
    version_json="$(curl -fsS --max-time 3 http://127.0.0.1:6439/version)" && \
    app_health_json="$(curl -fsS --max-time 3 http://127.0.0.1:6437/health)" && \
    HEALTH_JSON="$health_json" VERSION_JSON="$version_json" APP_HEALTH_JSON="$app_health_json" EXPECTED_COMMIT="$source_commit" EXPECTED_RELEASE="$release" EXPECTED_REGISTRY="$registry_runtime_sha" node <<'NODE'
const health=JSON.parse(process.env.HEALTH_JSON),version=JSON.parse(process.env.VERSION_JSON),app=JSON.parse(process.env.APP_HEALTH_JSON);
if(!health.ok||health.truthfulStatus!=="remote-canonical-wallet-gateway")process.exit(1);
if(!version.ok||version.build?.sourceCommit!==process.env.EXPECTED_COMMIT||version.build?.release!==process.env.EXPECTED_RELEASE||version.registrySha256!==process.env.EXPECTED_REGISTRY||!version.enabledProductClientIds?.includes("ynx-bridge-web-v1")||!version.enabledProductClientIds?.includes("ynx-creator-studio-web-v1")||!version.enabledProductClientIds?.includes("ynx-dex-web-v1"))process.exit(1);
if(!app.ok||!app.upstreams?.wallet?.ok||app.walletBoundary!=="p256-product-session-proof")process.exit(1);
NODE
  then
    runtime_ok=1
    break
  fi
  sleep 1
done
[[ "$runtime_ok" == "1" ]] || { echo "Wallet Gateway did not pass bounded runtime verification" >&2; exit 1; }
rollback_required=0
trap - EXIT
printf 'walletGatewayDeploy=passed\nrelease=%s\nsourceCommit=%s\nregistryFileSha256=%s\nregistryRuntimeSha256=%s\nbackup=%s\n' "$release" "$source_commit" "$registry_file_sha" "$registry_runtime_sha" "$backup_dir"
