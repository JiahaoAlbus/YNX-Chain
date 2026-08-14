#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?missing extracted release directory}"
source_commit="${2:?missing full source commit}"
release="${3:?missing release name}"
build_time="${4:?missing canonical build time}"
registry_file_sha="${5:?missing registry file digest}"
registry_runtime_sha="${6:?missing registry runtime digest}"
mode="${7:?missing transaction mode}"

[[ "$(id -u)" == "0" ]] || { echo "Wallet Gateway installer must run as root" >&2; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "source commit must be a full lowercase Git SHA" >&2; exit 1; }
[[ "$release" == "ynx-wallet-gateway-${source_commit:0:12}" ]] || { echo "release does not match source commit" >&2; exit 1; }
[[ "$build_time" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] || { echo "build time must be canonical UTC" >&2; exit 1; }
[[ "$registry_file_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "registry file digest is invalid" >&2; exit 1; }
[[ "$registry_runtime_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "registry runtime digest is invalid" >&2; exit 1; }
case "$mode" in rollback-drill | deploy) ;; *) echo "unsupported transaction mode" >&2; exit 1 ;; esac
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
caddy_file=/etc/caddy/ynx-chain.caddy
app_unit=/etc/systemd/system/ynx-app-gatewayd.service
app_env=/etc/ynx/ynx-app-gatewayd.env
product_session_unit=/etc/systemd/system/ynx-product-session-gatewayd.service
product_session_env=/etc/ynx/ynx-product-session-gatewayd.env
[[ -s "$unit" && ! -L "$unit" ]] || { echo "current Wallet Gateway unit is missing or unsafe" >&2; exit 1; }
[[ -s "$env_file" && ! -L "$env_file" ]] || { echo "current Wallet Gateway env is missing or unsafe" >&2; exit 1; }
[[ -s "$state_file" && ! -L "$state_file" ]] || { echo "current Wallet Gateway state is missing or unsafe" >&2; exit 1; }
[[ -s "$caddy_file" && ! -L "$caddy_file" ]] || { echo "current Caddy route file is missing or unsafe" >&2; exit 1; }
for adjacent_file in "$app_unit" "$app_env" "$product_session_unit" "$product_session_env"; do [[ -s "$adjacent_file" && ! -L "$adjacent_file" ]] || { echo "adjacent Gateway configuration is missing or unsafe" >&2; exit 1; }; done
[[ "$(stat -c '%a' "$state_dir")" == "700" ]] || { echo "Wallet Gateway state directory must be mode 0700" >&2; exit 1; }
[[ "$(stat -c '%a' "$state_file")" == "600" && "$(stat -c '%U:%G' "$state_file")" == "ynx:ynx" && "$(stat -c '%h' "$state_file")" == "1" ]] || { echo "Wallet Gateway state file ownership, mode or link count is unsafe" >&2; exit 1; }

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="/var/backups/ynx-chain/wallet-gateway-$release-$mode-$timestamp"
install -d -m 0700 "$backup_dir"
cp -a "$unit" "$backup_dir/ynx-wallet-gatewayd.service"
cp -a "$env_file" "$backup_dir/ynx-wallet-gatewayd.env"
cp -a "$state_file" "$backup_dir/state.json"
cp -a "$caddy_file" "$backup_dir/ynx-chain.caddy"
cp -a "$app_unit" "$backup_dir/ynx-app-gatewayd.service"
cp -a "$app_env" "$backup_dir/ynx-app-gatewayd.env"
cp -a "$product_session_unit" "$backup_dir/ynx-product-session-gatewayd.service"
cp -a "$product_session_env" "$backup_dir/ynx-product-session-gatewayd.env"
curl -fsS --max-time 5 http://127.0.0.1:6437/health >"$backup_dir/app-gateway-health.before.json"
curl -fsS --max-time 5 http://127.0.0.1:6439/version >"$backup_dir/wallet-gateway-version.before.json"
curl -fsS --max-time 5 http://127.0.0.1:6441/version >"$backup_dir/product-session-v2-version.before.json"
sha256sum "$caddy_file" >"$backup_dir/caddy.before.sha256"
previous_source="$(VERSION_FILE="$backup_dir/wallet-gateway-version.before.json" node -e 'const value=JSON.parse(require("node:fs").readFileSync(process.env.VERSION_FILE,"utf8")); process.stdout.write(value.build?.sourceCommit??"")')"
product_session_source="$(VERSION_FILE="$backup_dir/product-session-v2-version.before.json" node -e 'const value=JSON.parse(require("node:fs").readFileSync(process.env.VERSION_FILE,"utf8")); process.stdout.write(value.build?.sourceCommit??"")')"
[[ "$previous_source" =~ ^[0-9a-f]{40}$ ]] || { echo "current Wallet Gateway source identity is invalid" >&2; exit 1; }
[[ "$product_session_source" =~ ^[0-9a-f]{40}$ ]] || { echo "Product Session Gateway source identity is invalid" >&2; exit 1; }

umask 077
candidate_dir="/var/lib/ynx-chain/wallet-gateway-candidates/$release-$mode-$timestamp"
install -d -m 0700 -o ynx -g ynx "$candidate_dir"
preflight_state="$candidate_dir/state.json"
preflight_log="$candidate_dir/service.log"
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
  rm -rf "$candidate_dir"
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
YNX_WALLET_REJECTION_PROBE_URL=http://127.0.0.1:17439 \
YNX_WALLET_REJECTION_ALLOW_LOOPBACK=1 \
YNX_WALLET_REJECTION_REGISTRY_PATH="$release_dir/wallet-auth/central-registry.json" \
node "$release_dir/wallet-auth/scripts/probe-wallet-authorization-rejection.mjs" >"$backup_dir/candidate-rejection.json"
cleanup_preflight
trap - EXIT
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

restore_previous() {
  echo "Restoring prior Wallet Gateway unit, env and state" >&2
  install -m 0644 "$backup_dir/ynx-wallet-gatewayd.service" "$unit"
  install -m 0600 "$backup_dir/ynx-wallet-gatewayd.env" "$env_file"
  install -m 0600 -o ynx -g ynx "$backup_dir/state.json" "$state_file"
  rm -f "$new_unit" "$new_env"
  systemctl daemon-reload
  systemctl restart ynx-wallet-gatewayd
  restored=false
  for _ in $(seq 1 30); do
    if restored_version="$(curl -fsS --max-time 3 http://127.0.0.1:6439/version 2>/dev/null)" && VERSION_JSON="$restored_version" EXPECTED_SOURCE="$previous_source" node -e 'const value=JSON.parse(process.env.VERSION_JSON); if(!value.ok||value.build?.sourceCommit!==process.env.EXPECTED_SOURCE)process.exit(1)'; then restored=true; break; fi
    sleep 1
  done
  [[ "$restored" == true ]] || { echo "Prior Wallet Gateway did not become ready after rollback" >&2; return 1; }
}
rollback_required=true
on_exit() {
  exit_code=$?
  trap - EXIT
  if [[ "$rollback_required" == true ]]; then restore_previous || true; fi
  exit "$exit_code"
}
trap on_exit EXIT
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
YNX_WALLET_REJECTION_PROBE_URL=http://127.0.0.1:6439 \
YNX_WALLET_REJECTION_ALLOW_LOOPBACK=1 \
YNX_WALLET_REJECTION_REGISTRY_PATH="$release_dir/wallet-auth/central-registry.json" \
node "$release_dir/wallet-auth/scripts/probe-wallet-authorization-rejection.mjs" >"$backup_dir/local-rejection.json"
YNX_WALLET_REJECTION_PROBE_URL=https://rest.ynxweb4.com \
YNX_WALLET_REJECTION_HEALTH_URL=https://rest.ynxweb4.com/wallet-gateway/health \
YNX_WALLET_REJECTION_REGISTRY_PATH="$release_dir/wallet-auth/central-registry.json" \
node "$release_dir/wallet-auth/scripts/probe-wallet-authorization-rejection.mjs" >"$backup_dir/public-rejection.json"
curl -fsS --max-time 5 http://127.0.0.1:6437/health >"$backup_dir/app-gateway-health.after.json"
curl -fsS --max-time 5 http://127.0.0.1:6441/version >"$backup_dir/product-session-v2-version.after.json"
APP_FILE="$backup_dir/app-gateway-health.after.json" node -e 'const value=JSON.parse(require("node:fs").readFileSync(process.env.APP_FILE,"utf8")); if(!value.ok||value.service!=="ynx-app-gatewayd")process.exit(1)'
V2_FILE="$backup_dir/product-session-v2-version.after.json" EXPECTED_SOURCE="$product_session_source" node -e 'const value=JSON.parse(require("node:fs").readFileSync(process.env.V2_FILE,"utf8")); if(value.build?.sourceCommit!==process.env.EXPECTED_SOURCE)process.exit(1)'
cmp -s "$backup_dir/ynx-chain.caddy" "$caddy_file"
cmp -s "$backup_dir/ynx-app-gatewayd.service" "$app_unit"
cmp -s "$backup_dir/ynx-app-gatewayd.env" "$app_env"
cmp -s "$backup_dir/ynx-product-session-gatewayd.service" "$product_session_unit"
cmp -s "$backup_dir/ynx-product-session-gatewayd.env" "$product_session_env"
systemctl is-active --quiet ynx-app-gatewayd
systemctl is-active --quiet ynx-product-session-gatewayd
systemctl is-active --quiet caddy
[[ "$(stat -c '%a' "$state_file")" == "600" && "$(stat -c '%U:%G' "$state_file")" == "ynx:ynx" && "$(stat -c '%h' "$state_file")" == "1" ]] || { echo "Wallet Gateway state file changed to unsafe metadata" >&2; exit 1; }

if [[ "$mode" == "rollback-drill" ]]; then
  restore_previous
  rollback_required=false
  trap - EXIT
  cmp -s "$backup_dir/ynx-wallet-gatewayd.service" "$unit"
  cmp -s "$backup_dir/ynx-wallet-gatewayd.env" "$env_file"
  cmp -s "$backup_dir/state.json" "$state_file"
  cmp -s "$backup_dir/ynx-chain.caddy" "$caddy_file"
  cmp -s "$backup_dir/ynx-app-gatewayd.service" "$app_unit"
  cmp -s "$backup_dir/ynx-app-gatewayd.env" "$app_env"
  cmp -s "$backup_dir/ynx-product-session-gatewayd.service" "$product_session_unit"
  cmp -s "$backup_dir/ynx-product-session-gatewayd.env" "$product_session_env"
  curl -fsS --max-time 5 http://127.0.0.1:6437/health >"$backup_dir/app-gateway-health.rollback.json"
  curl -fsS --max-time 5 http://127.0.0.1:6441/version >"$backup_dir/product-session-v2-version.rollback.json"
  APP_FILE="$backup_dir/app-gateway-health.rollback.json" node -e 'const value=JSON.parse(require("node:fs").readFileSync(process.env.APP_FILE,"utf8")); if(!value.ok||value.service!=="ynx-app-gatewayd")process.exit(1)'
  V2_FILE="$backup_dir/product-session-v2-version.rollback.json" EXPECTED_SOURCE="$product_session_source" node -e 'const value=JSON.parse(require("node:fs").readFileSync(process.env.V2_FILE,"utf8")); if(value.build?.sourceCommit!==process.env.EXPECTED_SOURCE)process.exit(1)'
  rollback_status="$(curl -sS --max-time 10 -o "$backup_dir/public-rejection-after-rollback.json" -w '%{http_code}' -H 'accept: application/json' -H 'content-type: application/json' --data '{}' https://rest.ynxweb4.com/v1/wallet/authorizations/reject)"
  [[ "$rollback_status" == "404" ]]
  ROLLBACK_BODY="$backup_dir/public-rejection-after-rollback.json" node -e 'const value=JSON.parse(require("node:fs").readFileSync(process.env.ROLLBACK_BODY,"utf8")); if(value?.error?.code!=="ROUTE_NOT_FOUND")process.exit(1)'
  printf 'walletGatewayRollbackDrill=passed\nrelease=%s\nsourceCommit=%s\npreviousSourceCommit=%s\nbackup=%s\ncandidateRejection=%s\npublicRejectionBeforeRollback=%s\npublicRejectionAfterRollback=%s\nadjacentServicesAndCaddyUnchanged=true\n' "$release" "$source_commit" "$previous_source" "$backup_dir" "$backup_dir/candidate-rejection.json" "$backup_dir/public-rejection.json" "$backup_dir/public-rejection-after-rollback.json"
  exit 0
fi

rollback_required=false
trap - EXIT
printf 'walletGatewayDeploy=passed\nrelease=%s\nsourceCommit=%s\npreviousSourceCommit=%s\nregistryFileSha256=%s\nregistryRuntimeSha256=%s\nbackup=%s\ncandidateRejection=%s\nlocalRejection=%s\npublicRejection=%s\nadjacentServicesAndCaddyUnchanged=true\n' "$release" "$source_commit" "$previous_source" "$registry_file_sha" "$registry_runtime_sha" "$backup_dir" "$backup_dir/candidate-rejection.json" "$backup_dir/local-rejection.json" "$backup_dir/public-rejection.json"
