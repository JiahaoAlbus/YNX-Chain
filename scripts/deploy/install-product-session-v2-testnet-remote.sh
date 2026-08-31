#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?missing extracted release directory}"
source_commit="${2:?missing full source commit}"
release="${3:?missing release name}"
build_time="${4:?missing canonical build time}"
registry_file_sha="${5:?missing registry file digest}"
registry_runtime_sha="${6:?missing registry runtime digest}"
mode="${7:?missing transaction mode}"
[[ "$(id -u)" == "0" ]] || { echo "Product Session v2 installer must run as root" >&2; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "source commit must be a full lowercase Git SHA" >&2; exit 1; }
[[ "$release" == "ynx-product-session-v2-${source_commit:0:12}" ]] || { echo "release does not match source commit" >&2; exit 1; }
[[ "$build_time" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] || { echo "build time must be canonical UTC" >&2; exit 1; }
[[ "$registry_file_sha" =~ ^[0-9a-f]{64}$ && "$registry_runtime_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "registry digest is invalid" >&2; exit 1; }
case "$mode" in rollback-drill | deploy) ;; *) echo "unsupported transaction mode" >&2; exit 1 ;; esac
[[ -d "$release_dir" && ! -L "$release_dir" ]] || { echo "release directory is missing or unsafe" >&2; exit 1; }
for command in caddy curl node runuser sha256sum systemctl; do command -v "$command" >/dev/null; done
id -u ynx >/dev/null
(
  cd "$release_dir"
  sha256sum -c SHA256SUMS
)
printf '%s  %s\n' "$registry_file_sha" "$release_dir/wallet-auth/product-session-registry.json" | sha256sum -c -

service=ynx-product-session-gatewayd
unit="/etc/systemd/system/$service.service"
env_file="/etc/ynx/$service.env"
state_dir=/var/lib/ynx-chain/product-session-gateway-v2
state_file="$state_dir/state.json"
caddy_file=/etc/caddy/ynx-chain.caddy
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="/var/backups/ynx-chain/product-session-v2-$release-$mode-$timestamp"
install -d -m 0700 "$backup_dir"
cp -a "$caddy_file" "$backup_dir/ynx-chain.caddy"
unit_existed=false; env_existed=false; state_existed=false
if [[ -e "$unit" ]]; then [[ -f "$unit" && ! -L "$unit" ]] || { echo "existing unit is unsafe" >&2; exit 1; }; cp -a "$unit" "$backup_dir/service.unit"; unit_existed=true; fi
if [[ -e "$env_file" ]]; then [[ -f "$env_file" && ! -L "$env_file" ]] || { echo "existing env is unsafe" >&2; exit 1; }; cp -a "$env_file" "$backup_dir/service.env"; env_existed=true; fi
if [[ -e "$state_file" ]]; then [[ -f "$state_file" && ! -L "$state_file" ]] || { echo "existing state is unsafe" >&2; exit 1; }; cp -a "$state_file" "$backup_dir/state.json"; state_existed=true; fi
printf '%s\n' "$unit_existed" >"$backup_dir/unit-existed"
printf '%s\n' "$env_existed" >"$backup_dir/env-existed"
printf '%s\n' "$state_existed" >"$backup_dir/state-existed"

candidate_dir="/var/lib/ynx-chain/product-session-gateway-v2-candidates/$release-$mode-$timestamp"
install -d -m 0700 -o ynx -g ynx "$candidate_dir"
candidate_state="$candidate_dir/state.json"
if [[ "$state_existed" == true ]]; then install -m 0600 -o ynx -g ynx "$state_file" "$candidate_state"; fi
candidate_log="$candidate_dir/service.log"
runuser -u ynx -- env \
  YNX_PRODUCT_SESSION_GATEWAY_HTTP_ADDR=127.0.0.1 \
  YNX_PRODUCT_SESSION_GATEWAY_HTTP_PORT=17441 \
  YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH="$candidate_state" \
  YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH="$release_dir/wallet-auth/product-session-registry.json" \
  YNX_PRODUCT_SESSION_GATEWAY_REMOTE_DEPLOYED=true \
  YNX_PRODUCT_SESSION_GATEWAY_SOURCE_COMMIT="$source_commit" \
  YNX_PRODUCT_SESSION_GATEWAY_RELEASE="$release" \
  YNX_PRODUCT_SESSION_GATEWAY_BUILD_TIME="$build_time" \
  node "$release_dir/wallet-auth/scripts/ynx-product-session-gatewayd.mjs" >"$candidate_log" 2>&1 &
candidate_pid=$!
cleanup_candidate() { kill "$candidate_pid" 2>/dev/null || true; wait "$candidate_pid" 2>/dev/null || true; rm -rf "$candidate_dir"; }
trap cleanup_candidate EXIT
candidate_ok=false
for _ in $(seq 1 30); do
  if health="$(curl -fsS --max-time 3 http://127.0.0.1:17441/health)" && version="$(curl -fsS --max-time 3 http://127.0.0.1:17441/version)" && HEALTH="$health" VERSION="$version" EXPECTED_COMMIT="$source_commit" EXPECTED_REGISTRY="$registry_runtime_sha" node <<'NODE'
const health=JSON.parse(process.env.HEALTH),version=JSON.parse(process.env.VERSION);
if(!health.ok||health.service!=="ynx-product-session-gatewayd"||health.truthfulStatus!=="remote-product-session-v2-gateway")process.exit(1);
if(!version.ok||version.productSessionGatewaySchemaVersion!==2||version.registrySchemaVersion!==2||version.registrySha256!==process.env.EXPECTED_REGISTRY||version.build?.sourceCommit!==process.env.EXPECTED_COMMIT)process.exit(1);
NODE
  then candidate_ok=true; break; fi
  sleep 1
done
[[ "$candidate_ok" == true ]] || { echo "Product Session v2 candidate failed health/version preflight" >&2; exit 1; }
YNX_PRODUCT_SESSION_V2_PUBLIC_PROBE=1 YNX_PRODUCT_SESSION_V2_PUBLIC_URL=http://127.0.0.1:17441 YNX_PRODUCT_SESSION_V2_ALLOW_LOOPBACK=1 node "$release_dir/wallet-auth/scripts/probe-product-session-v2-public.mjs" >"$backup_dir/candidate-mount.json"
YNX_PRODUCT_SESSION_V2_LIFECYCLE=1 YNX_PRODUCT_SESSION_V2_LIFECYCLE_URL=http://127.0.0.1:17441 YNX_PRODUCT_SESSION_V2_ALLOW_LOOPBACK=1 node "$release_dir/wallet-auth/scripts/verify-product-session-v2-lifecycle.mjs" >"$backup_dir/candidate-lifecycle.json"
cleanup_candidate
trap - EXIT

new_unit="$backup_dir/service.unit.new"
new_env="$backup_dir/service.env.new"
cat >"$new_unit" <<EOF
[Unit]
Description=YNX Product Session v2 gateway
After=network-online.target
Wants=network-online.target

[Service]
User=ynx
Group=ynx
EnvironmentFile=$env_file
ExecStart=/usr/bin/env node $release_dir/wallet-auth/scripts/ynx-product-session-gatewayd.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=$state_dir

[Install]
WantedBy=multi-user.target
EOF
cat >"$new_env" <<EOF
YNX_PRODUCT_SESSION_GATEWAY_HTTP_ADDR=127.0.0.1
YNX_PRODUCT_SESSION_GATEWAY_HTTP_PORT=6441
YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH=$state_file
YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH=$release_dir/wallet-auth/product-session-registry.json
YNX_PRODUCT_SESSION_GATEWAY_REMOTE_DEPLOYED=true
YNX_PRODUCT_SESSION_GATEWAY_SOURCE_COMMIT=$source_commit
YNX_PRODUCT_SESSION_GATEWAY_RELEASE=$release
YNX_PRODUCT_SESSION_GATEWAY_BUILD_TIME=$build_time
YNX_PRODUCT_SESSION_GATEWAY_MAX_CONCURRENT=128
YNX_PRODUCT_SESSION_GATEWAY_RATE_LIMIT=600
EOF
chmod 0644 "$new_unit"; chmod 0600 "$new_env"

rollback() {
  set +e
  cp -a "$backup_dir/ynx-chain.caddy" "$caddy_file"
  if [[ "$(cat "$backup_dir/unit-existed")" == true ]]; then cp -a "$backup_dir/service.unit" "$unit"; else systemctl disable --now "$service" >/dev/null 2>&1; rm -f "$unit"; fi
  if [[ "$(cat "$backup_dir/env-existed")" == true ]]; then cp -a "$backup_dir/service.env" "$env_file"; else rm -f "$env_file"; fi
  if [[ "$(cat "$backup_dir/state-existed")" == true ]]; then install -d -m 0700 -o ynx -g ynx "$state_dir"; install -m 0600 -o ynx -g ynx "$backup_dir/state.json" "$state_file"; else rm -rf "$state_dir"; fi
  systemctl daemon-reload
  if [[ "$(cat "$backup_dir/unit-existed")" == true ]]; then systemctl restart "$service"; fi
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && systemctl reload caddy
  set -e
}
rollback_on_error=true
on_exit() { code=$?; trap - EXIT; if [[ "$rollback_on_error" == true ]]; then rollback; fi; exit "$code"; }
trap on_exit EXIT

install -d -m 0700 -o ynx -g ynx "$state_dir"
install -m 0644 "$new_unit" "$unit"
install -m 0600 "$new_env" "$env_file"
if ! grep -Fq '# BEGIN YNX PRODUCT SESSION V2 WALLET AUTH' "$caddy_file"; then
  awk '
    $0=="wallet-auth.ynxweb4.com, wallet-auth-testnet.43.153.202.237.sslip.io {" { in_wallet_auth=1 }
    in_wallet_auth && $0=="  reverse_proxy 127.0.0.1:18445" && !inserted {
      print "  # BEGIN YNX PRODUCT SESSION V2 WALLET AUTH";
      print "  @ynx_product_session_v2 path /v2/product-sessions/*";
      print "  handle @ynx_product_session_v2 {";
      print "    reverse_proxy 127.0.0.1:6441";
      print "  }";
      print "  handle {";
      print "    reverse_proxy 127.0.0.1:18445";
      print "  }";
      print "  # END YNX PRODUCT SESSION V2 WALLET AUTH";
      inserted=1;
      next
    }
    in_wallet_auth && $0=="}" { in_wallet_auth=0 }
    {print}
    END{if(!inserted)exit 42}
  ' "$caddy_file" >"$backup_dir/ynx-chain.caddy.new"
  install -m 0644 "$backup_dir/ynx-chain.caddy.new" "$caddy_file"
fi
grep -Fq '# BEGIN YNX PRODUCT SESSION V2 WALLET AUTH' "$caddy_file"
grep -Fq '@ynx_product_session_v2 path /v2/product-sessions/*' "$caddy_file"
grep -Fq 'reverse_proxy 127.0.0.1:6441' "$caddy_file"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl daemon-reload
systemctl enable --now "$service" >/dev/null
systemctl restart "$service"
systemctl reload caddy

runtime_ok=false
for _ in $(seq 1 30); do
  if health="$(curl -fsS --max-time 3 http://127.0.0.1:6441/health)" && version="$(curl -fsS --max-time 3 http://127.0.0.1:6441/version)" && HEALTH="$health" VERSION="$version" EXPECTED_COMMIT="$source_commit" EXPECTED_REGISTRY="$registry_runtime_sha" node <<'NODE'
const health=JSON.parse(process.env.HEALTH),version=JSON.parse(process.env.VERSION);
if(!health.ok||health.truthfulStatus!=="remote-product-session-v2-gateway")process.exit(1);
if(!version.ok||version.build?.sourceCommit!==process.env.EXPECTED_COMMIT||version.registrySha256!==process.env.EXPECTED_REGISTRY)process.exit(1);
NODE
  then runtime_ok=true; break; fi
  sleep 1
done
[[ "$runtime_ok" == true ]] || { echo "Product Session v2 runtime failed local verification" >&2; exit 1; }
YNX_PRODUCT_SESSION_V2_PUBLIC_PROBE=1 YNX_PRODUCT_SESSION_V2_PUBLIC_URL=https://wallet-auth.ynxweb4.com node "$release_dir/wallet-auth/scripts/probe-product-session-v2-public.mjs" >"$backup_dir/public-mount.json"

if [[ "$mode" == rollback-drill ]]; then
  rollback
  rollback_on_error=false
  trap - EXIT
  if [[ "$unit_existed" == true ]]; then
    cmp -s "$backup_dir/service.unit" "$unit"
    cmp -s "$backup_dir/service.env" "$env_file"
    cmp -s "$backup_dir/state.json" "$state_file"
    previous_commit=""
    for _ in $(seq 1 30); do
      if previous_version="$(curl -fsS --max-time 3 http://127.0.0.1:6441/version 2>/dev/null)"; then
        previous_commit="$(VERSION="$previous_version" node -e 'process.stdout.write(JSON.parse(process.env.VERSION).build.sourceCommit)')"
        break
      fi
      sleep 1
    done
    [[ "$previous_commit" =~ ^[0-9a-f]{40}$ && "$previous_commit" != "$source_commit" ]]
    YNX_PRODUCT_SESSION_V2_PUBLIC_PROBE=1 YNX_PRODUCT_SESSION_V2_PUBLIC_URL=https://wallet-auth.ynxweb4.com node "$release_dir/wallet-auth/scripts/probe-product-session-v2-public.mjs" >"$backup_dir/post-rollback-mount.json"
    post_rollback_result="restored-previous-v2-source-$previous_commit"
  else
    [[ ! -e "$unit" && ! -e "$env_file" && ! -e "$state_dir" ]] || { echo "rollback drill did not remove new service state" >&2; exit 1; }
    ! grep -Fq '# BEGIN YNX PRODUCT SESSION V2 WALLET AUTH' "$caddy_file"
    if YNX_PRODUCT_SESSION_V2_PUBLIC_PROBE=1 YNX_PRODUCT_SESSION_V2_PUBLIC_URL=https://wallet-auth.ynxweb4.com node "$release_dir/wallet-auth/scripts/probe-product-session-v2-public.mjs" >"$backup_dir/post-rollback-mount.stdout" 2>"$backup_dir/post-rollback-mount.json"; then echo "rollback drill left the new v2 public route mounted" >&2; exit 1; fi
    grep -Fq 'UNEXPECTED_HTTP_STATUS' "$backup_dir/post-rollback-mount.json"
    post_rollback_result="restored-pre-v2-public-fallback"
  fi
  systemctl is-active --quiet ynx-wallet-gatewayd
  systemctl is-active --quiet ynx-app-gatewayd
  curl -fsS --max-time 5 http://127.0.0.1:6439/health >/dev/null
  curl -fsS --max-time 5 http://127.0.0.1:6437/health >/dev/null
  printf 'productSessionV2RollbackDrill=passed\nsourceCommit=%s\nrelease=%s\nbackup=%s\npublicMountBeforeRollback=%s\npublicMountAfterRollback=%s\npostRollbackResult=%s\n' "$source_commit" "$release" "$backup_dir" "$backup_dir/public-mount.json" "$backup_dir/post-rollback-mount.json" "$post_rollback_result"
  exit 0
fi

YNX_PRODUCT_SESSION_V2_LIFECYCLE=1 YNX_PRODUCT_SESSION_V2_LIFECYCLE_URL=https://wallet-auth.ynxweb4.com node "$release_dir/wallet-auth/scripts/verify-product-session-v2-lifecycle.mjs" >"$backup_dir/public-lifecycle.json"
systemctl is-active --quiet ynx-wallet-gatewayd
systemctl is-active --quiet ynx-app-gatewayd
rollback_on_error=false
trap - EXIT
state_sha="$(curl -fsS --max-time 5 http://127.0.0.1:6441/health | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).stateSha256))')"
printf 'productSessionV2Deploy=passed\nsourceCommit=%s\nrelease=%s\nregistryFileSha256=%s\nregistryRuntimeSha256=%s\nstateSha256=%s\nbackup=%s\npublicMountEvidence=%s\npublicLifecycleEvidence=%s\n' "$source_commit" "$release" "$registry_file_sha" "$registry_runtime_sha" "$state_sha" "$backup_dir" "$backup_dir/public-mount.json" "$backup_dir/public-lifecycle.json"
