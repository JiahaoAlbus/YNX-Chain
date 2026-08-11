#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?missing release directory}"
source_commit="${2:?missing source commit}"
release="${3:?missing release name}"
build_time="${4:?missing build time}"
[[ "$(id -u)" == "0" ]] || { echo "Pay Product installer must run as root" >&2; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ && "$release" == "ynx-pay-product-${source_commit:0:12}" ]] || { echo "release identity is invalid" >&2; exit 1; }
[[ "$build_time" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] || { echo "build time is not canonical UTC" >&2; exit 1; }
[[ -d "$release_dir" && ! -L "$release_dir" ]] || { echo "release directory is unsafe" >&2; exit 1; }
command -v openssl >/dev/null
command -v runuser >/dev/null
command -v systemctl >/dev/null
id -u ynx >/dev/null
(cd "$release_dir" && sha256sum -c SHA256SUMS)

app_unit=/etc/systemd/system/ynx-app-gatewayd.service
app_env=/etc/ynx/ynx-app-gatewayd.env
central_env=/etc/ynx/ynx-payd.env
product_unit=/etc/systemd/system/ynx-pay-productd.service
product_env=/etc/ynx/ynx-pay-productd.env
state_dir=/var/lib/ynx-chain/pay-product
state_file="$state_dir/state.json"
for file in "$app_unit" "$app_env" "$central_env"; do [[ -s "$file" && ! -L "$file" ]] || { echo "required current file is missing or unsafe: $file" >&2; exit 1; }; done

umask 077
install -d -m 0700 -o ynx -g ynx "$state_dir"
set -a
# shellcheck disable=SC1090
. "$central_env"
set +a
[[ -n "${YNX_PAY_API_KEY:-}" && -n "${YNX_PAY_MERCHANT_ID:-}" ]] || { echo "central Pay credentials are incomplete" >&2; exit 1; }
if [[ -s "$product_env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$product_env"
  set +a
  assertion_key="${YNX_PAY_PRODUCT_GATEWAY_ASSERTION_KEY:?existing Pay Product assertion key missing}"
  integrity_key="${YNX_PAY_PRODUCT_INTEGRITY_KEY:?existing Pay Product integrity key missing}"
  bootstrap_key="${YNX_PAY_PRODUCT_BOOTSTRAP_KEY:?existing Pay Product bootstrap key missing}"
else
  assertion_key="$(openssl rand -hex 32)"
  integrity_key="$(openssl rand -hex 32)"
  bootstrap_key="$(openssl rand -hex 32)"
fi

new_product_env="/etc/ynx/.ynx-pay-productd.env.$release"
{
  printf 'YNX_PAY_PRODUCT_ADDR=127.0.0.1:6484\n'
  printf 'YNX_PAY_PRODUCT_STORE=%s\n' "$state_file"
  printf 'YNX_PAY_PRODUCT_PUBLIC_URL=https://rest.ynxweb4.com/app/pay-product\n'
  printf 'YNX_PAY_PRODUCT_CENTRAL_URL=http://127.0.0.1:6430\n'
  printf 'YNX_PAY_PRODUCT_INTEGRITY_KEY=%q\n' "$integrity_key"
  printf 'YNX_PAY_PRODUCT_GATEWAY_ASSERTION_KEY=%q\n' "$assertion_key"
  printf 'YNX_PAY_PRODUCT_BOOTSTRAP_KEY=%q\n' "$bootstrap_key"
  printf 'YNX_PAY_PRODUCT_CENTRAL_KEY=%q\n' "$YNX_PAY_API_KEY"
  printf 'YNX_PAY_PRODUCT_CENTRAL_MERCHANT_ID=%q\n' "$YNX_PAY_MERCHANT_ID"
} >"$new_product_env"
chmod 0600 "$new_product_env"

new_app_env="/etc/ynx/.ynx-app-gatewayd.env.$release"
awk '!/^YNX_APP_GATEWAY_PAY_PRODUCT_URL=/ && !/^YNX_APP_GATEWAY_PAY_PRODUCT_ASSERTION_KEY=/' "$app_env" >"$new_app_env"
{
  printf 'YNX_APP_GATEWAY_PAY_PRODUCT_URL=http://127.0.0.1:6484\n'
  printf 'YNX_APP_GATEWAY_PAY_PRODUCT_ASSERTION_KEY=%q\n' "$assertion_key"
} >>"$new_app_env"
chmod 0600 "$new_app_env"

new_product_unit="/etc/systemd/system/.ynx-pay-productd.service.$release"
cat >"$new_product_unit" <<EOF
[Unit]
Description=YNX Pay product service
After=network-online.target ynx-payd.service ynx-wallet-gatewayd.service
Wants=network-online.target ynx-payd.service ynx-wallet-gatewayd.service

[Service]
User=ynx
Group=ynx
EnvironmentFile=$product_env
ExecStart=$release_dir/bin/ynx-pay-productd
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
PrivateDevices=true
ReadWritePaths=$state_dir

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "$new_product_unit"
new_app_unit="/etc/systemd/system/.ynx-app-gatewayd.service.$release"
awk -v exec="ExecStart=$release_dir/bin/ynx-app-gatewayd" '/^ExecStart=/{print exec; next}{print}' "$app_unit" >"$new_app_unit"
chmod 0644 "$new_app_unit"

preflight_dir="$state_dir/.preflight-$release"
install -d -m 0700 -o ynx -g ynx "$preflight_dir"
if [[ -s "$state_file" ]]; then cp -a "$state_file" "$preflight_dir/state.json"; chown ynx:ynx "$preflight_dir/state.json"; fi
set -a
# shellcheck disable=SC1090
. "$new_product_env"
set +a
runuser -u ynx -- env YNX_PAY_PRODUCT_ADDR=127.0.0.1:17440 YNX_PAY_PRODUCT_STORE="$preflight_dir/state.json" "$release_dir/bin/ynx-pay-productd" >"$preflight_dir/product.log" 2>&1 &
preflight_pid=$!
cleanup_preflight() { kill "$preflight_pid" 2>/dev/null || true; wait "$preflight_pid" 2>/dev/null || true; rm -rf "$preflight_dir"; }
cleanup_candidates() { rm -f "$new_product_env" "$new_app_env" "$new_product_unit" "$new_app_unit"; }
preflight_failure_cleanup() { cleanup_preflight; cleanup_candidates; }
trap preflight_failure_cleanup EXIT
preflight_ok=0
for attempt in $(seq 1 20); do
  if health="$(curl -fsS --max-time 3 http://127.0.0.1:17440/health)" && HEALTH="$health" node -e 'const h=JSON.parse(process.env.HEALTH);if(h.service!=="ynx-pay-product"||h.liveness!=="live"||h.network!=="ynx_6423-1"||h.asset!=="YNXT")process.exit(1)'; then preflight_ok=1; break; fi
  sleep 1
done
[[ "$preflight_ok" == "1" ]] || { echo "Pay Product candidate preflight failed" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$new_app_env"
set +a
"$release_dir/bin/ynx-app-gatewayd" --check-config >/dev/null
cleanup_preflight
trap - EXIT

backup_dir="/var/backups/ynx-chain/pay-product-predeploy-$release"
install -d -m 0700 "$backup_dir"
cp -a "$app_unit" "$backup_dir/ynx-app-gatewayd.service"
cp -a "$app_env" "$backup_dir/ynx-app-gatewayd.env"
[[ -s "$product_unit" ]] && cp -a "$product_unit" "$backup_dir/ynx-pay-productd.service" || true
[[ -s "$product_env" ]] && cp -a "$product_env" "$backup_dir/ynx-pay-productd.env" || true
[[ -s "$state_file" ]] && cp -a "$state_file" "$backup_dir/state.json" || true

rollback_required=1
rollback() {
  code=$?
  trap - EXIT
  if [[ "$rollback_required" == "1" ]]; then
    echo "Pay Product deployment failed; restoring prior services" >&2
    install -m 0644 "$backup_dir/ynx-app-gatewayd.service" "$app_unit"
    install -m 0600 "$backup_dir/ynx-app-gatewayd.env" "$app_env"
    if [[ -s "$backup_dir/ynx-pay-productd.service" ]]; then install -m 0644 "$backup_dir/ynx-pay-productd.service" "$product_unit"; else rm -f "$product_unit"; fi
    if [[ -s "$backup_dir/ynx-pay-productd.env" ]]; then install -m 0600 "$backup_dir/ynx-pay-productd.env" "$product_env"; else rm -f "$product_env"; fi
    if [[ -s "$backup_dir/state.json" ]]; then install -m 0600 -o ynx -g ynx "$backup_dir/state.json" "$state_file"; else rm -f "$state_file"; fi
    systemctl daemon-reload || true
    systemctl restart ynx-app-gatewayd || true
    if [[ -s "$product_unit" ]]; then systemctl restart ynx-pay-productd || true; else systemctl stop ynx-pay-productd || true; fi
  fi
  exit "$code"
}
trap rollback EXIT
install -m 0600 "$new_product_env" "$product_env"
install -m 0600 "$new_app_env" "$app_env"
install -m 0644 "$new_product_unit" "$product_unit"
install -m 0644 "$new_app_unit" "$app_unit"
rm -f "$new_product_env" "$new_app_env" "$new_product_unit" "$new_app_unit"
systemctl daemon-reload
systemctl enable ynx-pay-productd >/dev/null
systemctl restart ynx-pay-productd
systemctl restart ynx-app-gatewayd

runtime_ok=0
for attempt in $(seq 1 30); do
  if product_health="$(curl -fsS --max-time 3 http://127.0.0.1:6484/health)" && app_health="$(curl -fsS --max-time 3 http://127.0.0.1:6437/app/health)" && route_health="$(curl -fsS --max-time 3 -H 'Origin: https://ynxweb4.com' http://127.0.0.1:6437/app/pay-product/health)" && PRODUCT="$product_health" APP="$app_health" ROUTE="$route_health" node -e 'const p=JSON.parse(process.env.PRODUCT),a=JSON.parse(process.env.APP),r=JSON.parse(process.env.ROUTE);if(p.service!=="ynx-pay-product"||r.service!=="ynx-pay-product"||!a.ok||!a.upstreams?.["pay-product"]?.ok)process.exit(1)'; then runtime_ok=1; break; fi
  sleep 1
done
[[ "$runtime_ok" == "1" ]] || { echo "Pay Product public route failed bounded runtime verification" >&2; exit 1; }
rollback_required=0
trap - EXIT
printf 'payProductDeploy=passed\nrelease=%s\nsourceCommit=%s\nbackup=%s\n' "$release" "$source_commit" "$backup_dir"
