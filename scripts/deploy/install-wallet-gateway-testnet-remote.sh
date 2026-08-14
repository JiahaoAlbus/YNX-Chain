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
v2_state_file="$state_dir/product-session-v2.json"
[[ -s "$unit" && ! -L "$unit" ]] || { echo "current Wallet Gateway unit is missing or unsafe" >&2; exit 1; }
[[ -s "$env_file" && ! -L "$env_file" ]] || { echo "current Wallet Gateway env is missing or unsafe" >&2; exit 1; }
[[ -s "$state_file" && ! -L "$state_file" ]] || { echo "current Wallet Gateway state is missing or unsafe" >&2; exit 1; }
[[ -x /usr/local/bin/ynx-app-gatewayd && ! -L /usr/local/bin/ynx-app-gatewayd ]] || { echo "current App Gateway binary is missing or unsafe" >&2; exit 1; }
[[ -s /etc/ynx/ynx-app-gatewayd.env && ! -L /etc/ynx/ynx-app-gatewayd.env ]] || { echo "current App Gateway env is missing or unsafe" >&2; exit 1; }
[[ "$(stat -c '%a' "$state_dir")" == "700" ]] || { echo "Wallet Gateway state directory must be mode 0700" >&2; exit 1; }

umask 077
preflight_state="$state_dir/.preflight-$release.json"
preflight_log="$state_dir/.preflight-$release.log"
preflight_v2_state="$state_dir/.preflight-v2-$release.json"
preflight_v2_response="$state_dir/.preflight-v2-$release.response.json"
candidate_state="$state_dir/.candidate-$release.json"
cp -a "$state_file" "$preflight_state"
if [[ -e "$v2_state_file" ]]; then
  [[ -s "$v2_state_file" && ! -L "$v2_state_file" && "$(stat -c '%a' "$v2_state_file")" == "600" && "$(stat -c '%h' "$v2_state_file")" == "1" ]] || { echo "Product Session v2 state is unsafe" >&2; exit 1; }
  cp -a "$v2_state_file" "$preflight_v2_state"
fi
chown ynx:ynx "$preflight_state"
chmod 0600 "$preflight_state"
if [[ -e "$preflight_v2_state" ]]; then chown ynx:ynx "$preflight_v2_state"; chmod 0600 "$preflight_v2_state"; fi
runuser -u ynx -- env \
  YNX_WALLET_GATEWAY_HTTP_ADDR=127.0.0.1 \
  YNX_WALLET_GATEWAY_HTTP_PORT=17439 \
  YNX_WALLET_GATEWAY_STATE_PATH="$preflight_state" \
  YNX_WALLET_GATEWAY_ALLOW_LEGACY_STATE_MIGRATION=true \
  YNX_WALLET_GATEWAY_REGISTRY_PATH="$release_dir/wallet-auth/central-registry.json" \
  YNX_WALLET_PRODUCT_SESSION_V2_STATE_PATH="$preflight_v2_state" \
  YNX_WALLET_PRODUCT_SESSION_V2_REGISTRY_PATH="$release_dir/wallet-auth/product-session-registry.json" \
  YNX_WALLET_GATEWAY_REMOTE_DEPLOYED=true \
  YNX_WALLET_GATEWAY_SOURCE_COMMIT="$source_commit" \
  YNX_WALLET_GATEWAY_RELEASE="$release" \
  YNX_WALLET_GATEWAY_BUILD_TIME="$build_time" \
  node "$release_dir/wallet-auth/scripts/ynx-wallet-gatewayd.mjs" >"$preflight_log" 2>&1 &
preflight_pid=$!
cleanup_preflight() {
  kill "$preflight_pid" 2>/dev/null || true
  wait "$preflight_pid" 2>/dev/null || true
  rm -f "$preflight_state" "$preflight_v2_state" "$preflight_v2_response" "$preflight_log"
}
trap cleanup_preflight EXIT
preflight_ok=0
for attempt in $(seq 1 20); do
  if version_json="$(curl -fsS --max-time 3 http://127.0.0.1:17439/version)" && \
    v2_status="$(curl -sS --max-time 3 -o "$preflight_v2_response" -w '%{http_code}' -H 'content-type: application/json' -H 'x-request-id: req_preflight_v2_00001' -d '{}' http://127.0.0.1:17439/v2/product-sessions/challenge)" && \
    VERSION_JSON="$version_json" V2_JSON="$(cat "$preflight_v2_response")" V2_STATUS="$v2_status" EXPECTED_COMMIT="$source_commit" EXPECTED_RELEASE="$release" EXPECTED_REGISTRY="$registry_runtime_sha" node <<'NODE'
const value=JSON.parse(process.env.VERSION_JSON);
if(!value.ok||value.service!=="ynx-wallet-gatewayd"||value.build?.sourceCommit!==process.env.EXPECTED_COMMIT||value.build?.release!==process.env.EXPECTED_RELEASE||value.registrySha256!==process.env.EXPECTED_REGISTRY||!value.enabledProductClientIds?.includes("ynx-bridge-web-v1")||!value.enabledProductClientIds?.includes("ynx-creator-studio-web-v1")||!value.enabledProductClientIds?.includes("ynx-dex-web-v1"))process.exit(1);
const v2=JSON.parse(process.env.V2_JSON);if(process.env.V2_STATUS!=="400"||v2.schemaVersion!==2||v2.requestId!=="req_preflight_v2_00001"||v2.ok!==false)process.exit(1);
NODE
  then
    preflight_ok=1
    break
  fi
  sleep 1
done
[[ "$preflight_ok" == "1" ]] || { echo "candidate Wallet Gateway failed state-migration preflight" >&2; exit 1; }
sudo_app_check="$(set -a; source /etc/ynx/ynx-app-gatewayd.env; set +a; "$release_dir/bin/ynx-app-gatewayd" --check-config)"
[[ "$sudo_app_check" == *"config check passed"* ]] || { echo "candidate App Gateway failed config preflight" >&2; exit 1; }
cp -a "$preflight_state" "$candidate_state"
chown ynx:ynx "$candidate_state"
chmod 0600 "$candidate_state"
cleanup_preflight
trap - EXIT
trap 'rm -f "$candidate_state"' EXIT

backup_dir="/var/backups/ynx-chain/wallet-gateway-predeploy-$release"
install -d -m 0700 "$backup_dir"
cp -a "$unit" "$backup_dir/ynx-wallet-gatewayd.service"
cp -a "$env_file" "$backup_dir/ynx-wallet-gatewayd.env"
cp -a "$state_file" "$backup_dir/state.json"
cp -a /usr/local/bin/ynx-app-gatewayd "$backup_dir/ynx-app-gatewayd"
if [[ -e "$v2_state_file" ]]; then cp -a "$v2_state_file" "$backup_dir/product-session-v2.json"; fi
new_unit="/etc/systemd/system/.ynx-wallet-gatewayd.service.$release"
new_env="/etc/ynx/.ynx-wallet-gatewayd.env.$release"
awk -v exec="ExecStart=/usr/bin/env node $release_dir/wallet-auth/scripts/ynx-wallet-gatewayd.mjs" '/^ExecStart=/{print exec; next}{print}' "$unit" >"$new_unit"
awk '!/^YNX_WALLET_GATEWAY_REGISTRY_PATH=/ && !/^YNX_WALLET_PRODUCT_SESSION_V2_STATE_PATH=/ && !/^YNX_WALLET_PRODUCT_SESSION_V2_REGISTRY_PATH=/ && !/^YNX_WALLET_GATEWAY_SOURCE_COMMIT=/ && !/^YNX_WALLET_GATEWAY_RELEASE=/ && !/^YNX_WALLET_GATEWAY_BUILD_TIME=/' "$env_file" >"$new_env"
cat >>"$new_env" <<EOF
YNX_WALLET_GATEWAY_REGISTRY_PATH=$release_dir/wallet-auth/central-registry.json
YNX_WALLET_PRODUCT_SESSION_V2_STATE_PATH=$v2_state_file
YNX_WALLET_PRODUCT_SESSION_V2_REGISTRY_PATH=$release_dir/wallet-auth/product-session-registry.json
YNX_WALLET_GATEWAY_SOURCE_COMMIT=$source_commit
YNX_WALLET_GATEWAY_RELEASE=$release
YNX_WALLET_GATEWAY_BUILD_TIME=$build_time
EOF
chmod 0644 "$new_unit"
chmod 0600 "$new_env"
grep -Fxq "ExecStart=/usr/bin/env node $release_dir/wallet-auth/scripts/ynx-wallet-gatewayd.mjs" "$new_unit"
grep -Fxq "YNX_WALLET_GATEWAY_REGISTRY_PATH=$release_dir/wallet-auth/central-registry.json" "$new_env"
grep -Fxq "YNX_WALLET_PRODUCT_SESSION_V2_STATE_PATH=$v2_state_file" "$new_env"
grep -Fxq "YNX_WALLET_PRODUCT_SESSION_V2_REGISTRY_PATH=$release_dir/wallet-auth/product-session-registry.json" "$new_env"

rollback_required=1
rollback() {
  exit_code=$?
  trap - EXIT
  if [[ "$rollback_required" == "1" ]]; then
    echo "Wallet Gateway install failed; restoring prior unit, env and state" >&2
    install -m 0644 "$backup_dir/ynx-wallet-gatewayd.service" "$unit"
    install -m 0600 "$backup_dir/ynx-wallet-gatewayd.env" "$env_file"
    install -m 0600 -o ynx -g ynx "$backup_dir/state.json" "$state_file"
    install -m 0755 "$backup_dir/ynx-app-gatewayd" /usr/local/bin/ynx-app-gatewayd
    if [[ -e "$backup_dir/product-session-v2.json" ]]; then install -m 0600 -o ynx -g ynx "$backup_dir/product-session-v2.json" "$v2_state_file"; else rm -f "$v2_state_file"; fi
    rm -f "$new_unit" "$new_env"
    systemctl daemon-reload || true
    systemctl restart ynx-wallet-gatewayd || true
    systemctl restart ynx-app-gatewayd || true
  fi
  if [[ -n "${runtime_v2_response:-}" ]]; then rm -f "$runtime_v2_response"; fi
  rm -f "$candidate_state"
  exit "$exit_code"
}
trap rollback EXIT
install -m 0644 "$new_unit" "$unit"
install -m 0600 "$new_env" "$env_file"
install -m 0600 -o ynx -g ynx "$candidate_state" "$state_file"
install -m 0755 "$release_dir/bin/ynx-app-gatewayd" /usr/local/bin/ynx-app-gatewayd
rm -f "$new_unit" "$new_env"
systemctl daemon-reload
systemctl restart ynx-wallet-gatewayd
systemctl restart ynx-app-gatewayd

runtime_ok=0
runtime_v2_response="$state_dir/.runtime-v2-$release.response.json"
for attempt in $(seq 1 30); do
  if health_json="$(curl -fsS --max-time 3 http://127.0.0.1:6439/health)" && \
    version_json="$(curl -fsS --max-time 3 http://127.0.0.1:6439/version)" && \
    app_version_json="$(curl -fsS --max-time 3 http://127.0.0.1:6437/app/version)" && \
    v2_status="$(curl -sS --max-time 3 -o "$runtime_v2_response" -w '%{http_code}' -H 'content-type: application/json' -H 'x-request-id: req_runtime_v2_0000001' -d '{}' http://127.0.0.1:6437/v2/product-sessions/challenge)" && \
    HEALTH_JSON="$health_json" VERSION_JSON="$version_json" APP_VERSION_JSON="$app_version_json" V2_JSON="$(cat "$runtime_v2_response")" V2_STATUS="$v2_status" EXPECTED_COMMIT="$source_commit" EXPECTED_RELEASE="$release" EXPECTED_REGISTRY="$registry_runtime_sha" node <<'NODE'
const health=JSON.parse(process.env.HEALTH_JSON),version=JSON.parse(process.env.VERSION_JSON),app=JSON.parse(process.env.APP_VERSION_JSON);
if(!health.ok||health.truthfulStatus!=="remote-canonical-wallet-gateway")process.exit(1);
if(!version.ok||version.build?.sourceCommit!==process.env.EXPECTED_COMMIT||version.build?.release!==process.env.EXPECTED_RELEASE||version.registrySha256!==process.env.EXPECTED_REGISTRY||!version.enabledProductClientIds?.includes("ynx-bridge-web-v1")||!version.enabledProductClientIds?.includes("ynx-creator-studio-web-v1")||!version.enabledProductClientIds?.includes("ynx-dex-web-v1"))process.exit(1);
if(!app.ok||app.service!=="ynx-app-gatewayd"||app.remoteDeployed!==true||app.build?.commit!==process.env.EXPECTED_COMMIT||app.build?.release!==process.env.EXPECTED_RELEASE)process.exit(1);
const v2=JSON.parse(process.env.V2_JSON);if(process.env.V2_STATUS!=="400"||v2.schemaVersion!==2||v2.requestId!=="req_runtime_v2_0000001"||v2.ok!==false)process.exit(1);
NODE
  then
    runtime_ok=1
    break
  fi
  sleep 1
done
[[ "$runtime_ok" == "1" ]] || { echo "Wallet Gateway did not pass bounded runtime verification" >&2; exit 1; }
rm -f "$runtime_v2_response"
rollback_required=0
trap - EXIT
rm -f "$candidate_state"
printf 'walletGatewayDeploy=passed\nrelease=%s\nsourceCommit=%s\nregistryFileSha256=%s\nregistryRuntimeSha256=%s\nbackup=%s\n' "$release" "$source_commit" "$registry_file_sha" "$registry_runtime_sha" "$backup_dir"
