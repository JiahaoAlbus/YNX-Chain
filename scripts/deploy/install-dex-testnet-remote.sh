#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?missing extracted release directory}"
source_commit="${2:?missing full source commit}"
release="${3:?missing release name}"
build_time="${4:?missing canonical build time}"
binary_sha="${5:?missing binary digest}"
web_sha="${6:?missing web tree digest}"
native_rest_url="${7:-http://127.0.0.1:6420}"

[[ "$(id -u)" == "0" ]] || { echo "DEX installer must run as root" >&2; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "source commit must be a full lowercase Git SHA" >&2; exit 1; }
[[ "$release" == "ynx-dex-${source_commit:0:12}" ]] || { echo "release does not match source commit" >&2; exit 1; }
[[ "$build_time" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] || { echo "build time must be canonical UTC" >&2; exit 1; }
[[ "$binary_sha" =~ ^[0-9a-f]{64}$ && "$web_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "release digest is invalid" >&2; exit 1; }
[[ "$native_rest_url" == "http://127.0.0.1:6420" ]] || { echo "native DEX source must be the local authoritative Testnet REST origin" >&2; exit 1; }
[[ -d "$release_dir" && ! -L "$release_dir" ]] || { echo "release directory is missing or unsafe" >&2; exit 1; }
for command in caddy curl node runuser sha256sum systemctl; do command -v "$command" >/dev/null; done
id -u ynx >/dev/null
(
  cd "$release_dir"
  sha256sum -c SHA256SUMS
)
printf '%s  %s\n' "$binary_sha" "$release_dir/ynx-dex-indexerd" | sha256sum -c -
actual_web_sha="$(cd "$release_dir/web" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
[[ "$actual_web_sha" == "$web_sha" ]] || { echo "DEX web tree digest mismatch" >&2; exit 1; }

unit=/etc/systemd/system/ynx-dex-indexerd.service
env_file=/etc/ynx/dex.env
caddy_file=/etc/caddy/conf.d/ynx-dex.caddy
current_link=/opt/ynx/dex-current
state_dir=/var/lib/ynx/dex
state_file="$state_dir/indexer-state.json"
for path in "$unit" "$env_file" "$caddy_file"; do
  [[ -s "$path" && ! -L "$path" ]] || { echo "current DEX deployment file is missing or unsafe: $path" >&2; exit 1; }
done
[[ -L "$current_link" ]] || { echo "current DEX release pointer must be a symlink" >&2; exit 1; }
prior_target="$(readlink -f "$current_link")"
[[ -d "$prior_target" && "$prior_target" != "$release_dir" ]] || { echo "current DEX release target is invalid or already selected" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a
: "${YNX_DEX_STATE_HMAC_SECRET:?existing DEX state key missing}"
: "${YNX_DEX_INDEXER_INGESTION_KEY:?existing DEX ingestion key missing}"
[[ -z "${DEX_FACTORY_ADDRESS:-}" ]] || {
  echo "chain-native deployment refuses a competing EVM factory source" >&2
  exit 1
}
[[ -z "${YNX_DEX_NATIVE_REST_URL:-}" || "$YNX_DEX_NATIVE_REST_URL" == "$native_rest_url" ]] || { echo "existing native DEX source conflicts with the requested source" >&2; exit 1; }

umask 077
preflight_state="$state_dir/.preflight-$release.json"
preflight_log="$state_dir/.preflight-$release.log"
rm -f "$preflight_state" "$preflight_log"
if [[ -s "$state_file" ]]; then
  cp -a "$state_file" "$preflight_state"
  chown ynx:ynx "$preflight_state"
  chmod 0600 "$preflight_state"
fi
runuser -u ynx -- env -i PATH=/usr/bin:/bin \
  YNX_DEX_HTTP_ADDR=127.0.0.1:17482 \
  YNX_DEX_STATE_PATH="$preflight_state" \
  YNX_DEX_TOKEN_LIST_PATH="$release_dir/token-lists/dex-testnet.json" \
  YNX_DEX_STATE_HMAC_SECRET="$YNX_DEX_STATE_HMAC_SECRET" \
  YNX_DEX_INDEXER_INGESTION_KEY="$YNX_DEX_INDEXER_INGESTION_KEY" \
  YNX_DEX_WALLET_INTROSPECTION_URL=http://127.0.0.1:6439/v1/wallet/sessions/introspect \
  YNX_DEX_NATIVE_REST_URL="$native_rest_url" \
  "$release_dir/ynx-dex-indexerd" >"$preflight_log" 2>&1 &
preflight_pid=$!
cleanup_preflight() {
  kill "$preflight_pid" 2>/dev/null || true
  wait "$preflight_pid" 2>/dev/null || true
  rm -f "$preflight_state" "$preflight_log"
}
trap cleanup_preflight EXIT
preflight_ok=0
for attempt in $(seq 1 20); do
  if version_json="$(curl -fsS --max-time 3 http://127.0.0.1:17482/version)" && \
    health_json="$(curl -fsS --max-time 3 http://127.0.0.1:17482/health)" && \
    tokens_json="$(curl -fsS --max-time 3 http://127.0.0.1:17482/v1/tokens)" && \
    VERSION_JSON="$version_json" HEALTH_JSON="$health_json" TOKENS_JSON="$tokens_json" EXPECTED_COMMIT="$source_commit" EXPECTED_RELEASE="$release" node <<'NODE'
const version=JSON.parse(process.env.VERSION_JSON),health=JSON.parse(process.env.HEALTH_JSON),tokens=JSON.parse(process.env.TOKENS_JSON);
if(version.commit!==process.env.EXPECTED_COMMIT||version.release!==process.env.EXPECTED_RELEASE)process.exit(1);
if(health.status!=="ok"||health.productId!=="ynx-dex"||health.chainId!==6423||health.marketSourceConfigured!==true||health.marketAvailable!==(health.indexedPools>0)||health.executionAvailable!==false||health.executionGate!=="chain_core_strategy_vault_v1_35_product_evidence"||health.executionGateSatisfied!==false)process.exit(1);
if(tokens.chainId!==6423||tokens.mainnet!==false||!Array.isArray(tokens.items)||tokens.items.length<1||tokens.items[0]?.address!=="YNXT")process.exit(1);
NODE
  then
    preflight_ok=1
    break
  fi
  sleep 1
done
[[ "$preflight_ok" == "1" ]] || { echo "candidate DEX failed isolated preflight" >&2; exit 1; }
cleanup_preflight
trap - EXIT

backup_dir="/var/backups/ynx-dex/$(date -u +%Y%m%dT%H%M%SZ)-pre-${source_commit:0:12}"
install -d -m 0700 "$backup_dir"
cp -a "$unit" "$backup_dir/ynx-dex-indexerd.service"
cp -a "$env_file" "$backup_dir/dex.env"
cp -a "$caddy_file" "$backup_dir/ynx-dex.caddy"
printf '%s\n' "$prior_target" >"$backup_dir/prior-release-target"
state_existed=0
if [[ -s "$state_file" ]]; then
  cp -a "$state_file" "$backup_dir/indexer-state.json"
  state_existed=1
fi

new_env="/etc/ynx/.dex.env.$release"
awk '!/^YNX_DEX_TOKEN_LIST_PATH=/ && !/^YNX_DEX_WALLET_INTROSPECTION_URL=/ && !/^YNX_DEX_NATIVE_REST_URL=/ && !/^DEX_FACTORY_ADDRESS=/' "$env_file" >"$new_env"
cat >>"$new_env" <<EOF
YNX_DEX_TOKEN_LIST_PATH=$release_dir/token-lists/dex-testnet.json
YNX_DEX_WALLET_INTROSPECTION_URL=http://127.0.0.1:6439/v1/wallet/sessions/introspect
YNX_DEX_NATIVE_REST_URL=$native_rest_url
EOF
chmod 0600 "$new_env"

new_caddy="/etc/caddy/conf.d/.ynx-dex.caddy.$release"
cat >"$new_caddy" <<'CADDY'
dex.ynxweb4.com, dex-testnet.43.153.202.237.sslip.io {
	encode zstd gzip
	handle_path /wallet-gateway/* {
		reverse_proxy 127.0.0.1:6439
	}
	handle /health {
		reverse_proxy 127.0.0.1:6482
	}
	handle /version {
		reverse_proxy 127.0.0.1:6482
	}
	handle /v1/* {
		reverse_proxy 127.0.0.1:6482
	}
	handle {
		root * /opt/ynx/dex-current/web
		try_files {path} /index.html
		file_server
	}
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		Content-Security-Policy "default-src 'self'; connect-src 'self' https://rest.ynxweb4.com; img-src 'self' data:; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'"
		Referrer-Policy no-referrer
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		X-Content-Type-Options nosniff
	}
}
CADDY
chmod 0644 "$new_caddy"

rollback_required=1
rollback() {
  exit_code=$?
  trap - EXIT
  if [[ "$rollback_required" == "1" ]]; then
    echo "DEX install failed; restoring prior release, ingress, environment and state" >&2
    ln -sfn "$prior_target" "$current_link"
    install -m 0600 "$backup_dir/dex.env" "$env_file"
    install -m 0644 "$backup_dir/ynx-dex.caddy" "$caddy_file"
    if [[ "$state_existed" == "1" ]]; then
      install -m 0640 -o ynx -g ynx "$backup_dir/indexer-state.json" "$state_file"
    else
      rm -f "$state_file"
    fi
    rm -f "$new_env" "$new_caddy"
    systemctl restart ynx-dex-indexerd || true
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy || true
  fi
  exit "$exit_code"
}
trap rollback EXIT

next_link="/opt/ynx/.dex-current-$release"
ln -s "$release_dir" "$next_link"
mv -Tf "$next_link" "$current_link"
install -m 0600 "$new_env" "$env_file"
install -m 0644 "$new_caddy" "$caddy_file"
rm -f "$new_env" "$new_caddy"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl restart ynx-dex-indexerd
systemctl reload caddy

runtime_ok=0
for attempt in $(seq 1 30); do
  if version_json="$(curl -fsS --max-time 3 http://127.0.0.1:6482/version)" && \
    health_json="$(curl -fsS --max-time 3 http://127.0.0.1:6482/health)" && \
    tokens_json="$(curl -fsS --max-time 3 http://127.0.0.1:6482/v1/tokens)" && \
    gateway_json="$(curl -fsS --max-time 5 https://dex.ynxweb4.com/wallet-gateway/health)" && \
    VERSION_JSON="$version_json" HEALTH_JSON="$health_json" TOKENS_JSON="$tokens_json" GATEWAY_JSON="$gateway_json" EXPECTED_COMMIT="$source_commit" EXPECTED_RELEASE="$release" node <<'NODE'
const version=JSON.parse(process.env.VERSION_JSON),health=JSON.parse(process.env.HEALTH_JSON),tokens=JSON.parse(process.env.TOKENS_JSON),gateway=JSON.parse(process.env.GATEWAY_JSON);
if(version.commit!==process.env.EXPECTED_COMMIT||version.release!==process.env.EXPECTED_RELEASE)process.exit(1);
if(health.status!=="ok"||health.marketSourceConfigured!==true||health.marketAvailable!==(health.indexedPools>0)||health.executionAvailable!==false||health.executionGate!=="chain_core_strategy_vault_v1_35_product_evidence"||health.executionGateSatisfied!==false)process.exit(1);
if(!Array.isArray(tokens.items)||tokens.items.length<1||tokens.items[0]?.address!=="YNXT")process.exit(1);
if(!gateway.ok||gateway.service!=="ynx-wallet-gatewayd"||gateway.truthfulStatus!=="remote-canonical-wallet-gateway")process.exit(1);
NODE
  then
    runtime_ok=1
    break
  fi
  sleep 1
done
[[ "$runtime_ok" == "1" ]] || { echo "DEX did not pass bounded public runtime verification" >&2; exit 1; }
[[ "$(systemctl is-active ynx-dex-indexerd)" == "active" && "$(systemctl is-active caddy)" == "active" ]] || { echo "DEX or Caddy is inactive" >&2; exit 1; }

rollback_required=0
trap - EXIT
runtime_market="$(HEALTH_JSON="$health_json" node -e 'process.stdout.write(String(JSON.parse(process.env.HEALTH_JSON).marketAvailable))')"
runtime_execution="$(HEALTH_JSON="$health_json" node -e 'process.stdout.write(String(JSON.parse(process.env.HEALTH_JSON).executionAvailable))')"
printf 'dexDeploy=passed\nrelease=%s\nsourceCommit=%s\nbinarySha256=%s\nwebTreeSha256=%s\nbackup=%s\nmarketSourceConfigured=true\nmarketAvailable=%s\nexecutionAvailable=%s\n' \
  "$release" "$source_commit" "$binary_sha" "$web_sha" "$backup_dir" "$runtime_market" "$runtime_execution"
