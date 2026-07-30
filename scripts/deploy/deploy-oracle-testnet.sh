#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh
ynx_load_env

required=(ORACLE_API_DOMAIN ORACLE_PUBLIC_ORIGIN ORACLE_PROVIDER_REGISTRY ORACLE_NONCE_DOMAIN)
ynx_require_env "${required[@]}"
ynx_reject_unsafe_env_values "${required[@]}"
ORACLE_REMOTE_ENV_PATH="${ORACLE_REMOTE_ENV_PATH:-/etc/ynx-oracle/oracle.env}"
ORACLE_PROVIDER_DEPLOYMENT_JSON="${ORACLE_PROVIDER_DEPLOYMENT_JSON:-}"
source_mode="${ORACLE_SOURCE_MODE:-authoritative}"
smoke_execution="${ORACLE_SMOKE_EXECUTION:-local}"
command -v git >/dev/null
command -v go >/dev/null
command -v jq >/dev/null
command -v tar >/dev/null

[[ "$ORACLE_API_DOMAIN" =~ ^[A-Za-z0-9.-]+$ && "$ORACLE_API_DOMAIN" == *.* ]] || {
  echo "ORACLE_API_DOMAIN must be a DNS hostname" >&2
  exit 1
}
[[ "$ORACLE_PUBLIC_ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || {
  echo "ORACLE_PUBLIC_ORIGIN must be an HTTPS origin" >&2
  exit 1
}
[[ "$ORACLE_NONCE_DOMAIN" =~ ^[A-Za-z0-9:._-]{8,128}$ ]] || {
  echo "ORACLE_NONCE_DOMAIN is invalid" >&2
  exit 1
}
[[ "$ORACLE_REMOTE_ENV_PATH" =~ ^/etc/ynx-oracle/[A-Za-z0-9._-]+$ ]] || {
  echo "ORACLE_REMOTE_ENV_PATH must be a file directly under /etc/ynx-oracle" >&2
  exit 1
}
[[ -f "$ORACLE_PROVIDER_REGISTRY" && ! -L "$ORACLE_PROVIDER_REGISTRY" ]] || {
  echo "ORACLE_PROVIDER_REGISTRY must be a regular non-symlink file" >&2
  exit 1
}
case "$source_mode" in
  authoritative | limited) ;;
  *) echo "ORACLE_SOURCE_MODE must be authoritative or limited" >&2; exit 1 ;;
esac
case "$smoke_execution" in
  local | remote) ;;
  *) echo "ORACLE_SMOKE_EXECUTION must be local or remote" >&2; exit 1 ;;
esac

target_arch="${ORACLE_TARGET_ARCH:-amd64}"
case "$target_arch" in
  amd64 | arm64) ;;
  *) echo "ORACLE_TARGET_ARCH must be amd64 or arm64" >&2; exit 1 ;;
esac

if [[ "$source_mode" == "authoritative" ]]; then
  [[ -f "$ORACLE_PROVIDER_DEPLOYMENT_JSON" && ! -L "$ORACLE_PROVIDER_DEPLOYMENT_JSON" ]] || {
    echo "ORACLE_PROVIDER_DEPLOYMENT_JSON must be a regular non-symlink file in authoritative mode" >&2
    exit 1
  }
  jq -e '
    .schema == "ynx.oracle.v1" and
    (.providers | type == "array") and
    ([.providers[] | select(.status == "active")] | length) >= 3 and
    ([.providers[] | select(.status == "active") | .id] | unique | length) ==
      ([.providers[] | select(.status == "active")] | length) and
    ([.providers[] | select(.status == "active") | .reporterId] | unique | length) ==
      ([.providers[] | select(.status == "active")] | length) and
    ([.providers[] | select(.status == "active") | .reporterPublicKeyHex] | unique | length) ==
      ([.providers[] | select(.status == "active")] | length)
  ' "$ORACLE_PROVIDER_REGISTRY" >/dev/null || {
    echo "Authoritative registry needs at least three independent active reporters" >&2
    exit 1
  }
  jq -e '
    .schema == "ynx.oracle.testnet-deployment.v1" and
    (.providers | type == "array") and
    (.providers | length) >= 3 and
    ([.providers[].id] | unique | length) == (.providers | length) and
    all(.providers[];
      (.id | test("^[a-z0-9][a-z0-9-]{1,62}$")) and
      (.adapter == "coinbase" or .adapter == "kraken" or .adapter == "bitstamp") and
      (.symbol | test("^[A-Za-z0-9._/-]{3,32}$")) and
      (.market | test("^[A-Z0-9]{2,16}/[A-Z0-9_]{2,16}$")) and
      (.scale | type == "number") and .scale >= 1 and .scale <= 1000000000000 and
      (.intervalSeconds | type == "number") and .intervalSeconds >= 1 and .intervalSeconds <= 3600 and
      (.signerPath | test("^/etc/ynx-oracle/signers/[a-z0-9][a-z0-9-]{1,62}\\.key$"))
    )
  ' "$ORACLE_PROVIDER_DEPLOYMENT_JSON" >/dev/null || {
    echo "Oracle provider deployment manifest is invalid" >&2
    exit 1
  }
  while IFS=$'\t' read -r provider_id market; do
    jq -e --arg id "$provider_id" --arg market "$market" '
      any(.providers[]; .id == $id and .status == "active" and (.assetMarketCoverage | index($market) != null))
    ' "$ORACLE_PROVIDER_REGISTRY" >/dev/null || {
      echo "Deployment provider is not active or does not cover its market: $provider_id $market" >&2
      exit 1
    }
  done < <(jq -r '.providers[] | [.id, .market] | @tsv' "$ORACLE_PROVIDER_DEPLOYMENT_JSON")
else
  [[ -z "$ORACLE_PROVIDER_DEPLOYMENT_JSON" ]] || {
    echo "Limited mode must not configure provider workers or signer paths" >&2
    exit 1
  }
  jq -e '
    .schema == "ynx.oracle.provider-candidates.v1" and
    .productionRegistry == false and
    (.candidates | type == "array") and
    (.candidates | length) >= 1 and
    all(.candidates[]; .status != "active" and .ynxMarketCoverage == false) and
    (.sourceLimitation | type == "string") and
    (.sourceLimitation | length) >= 20
  ' "$ORACLE_PROVIDER_REGISTRY" >/dev/null || {
    echo "Limited mode requires the inactive candidate registry and an explicit source limitation" >&2
    exit 1
  }
fi

if [[ "${PACKAGE_ONLY:-0}" != "1" ]]; then
  deploy_required=(SERVER_HOST SERVER_USER SSH_KEY_PATH)
  ynx_require_env "${deploy_required[@]}"
  ynx_reject_unsafe_env_values "${deploy_required[@]}"
  [[ -f "$SSH_KEY_PATH" && ! -L "$SSH_KEY_PATH" ]] || {
    echo "SSH_KEY_PATH must be a regular non-symlink file" >&2
    exit 1
  }
  if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
    ynx_require_clean_worktree
  fi
fi

commit="$(git rev-parse HEAD)"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]]
release="ynx-oracle-${commit}"
stage="$(mktemp -d)"
cleanup() {
  rm -rf "$stage"
}
trap cleanup EXIT
bundle="$stage/$release"
mkdir -p "$bundle/bin" "$bundle/config" "$bundle/systemd" "$bundle/caddy" "$bundle/scripts"
deployment_manifest="$ORACLE_PROVIDER_DEPLOYMENT_JSON"
if [[ "$source_mode" == "limited" ]]; then
  deployment_manifest="$stage/provider-deployment.json"
  printf '%s\n' '{"schema":"ynx.oracle.testnet-deployment.v1","providers":[]}' > "$deployment_manifest"
fi

printf 'building Oracle Testnet binaries for linux/%s\n' "$target_arch"
GOOS=linux GOARCH="$target_arch" CGO_ENABLED=0 go build -trimpath \
  -ldflags="-s -w -buildid= -X github.com/JiahaoAlbus/YNX-Chain/internal/oracle.BuildCommit=$commit" \
  -o "$bundle/bin/ynx-oracled" ./cmd/ynx-oracled
GOOS=linux GOARCH="$target_arch" CGO_ENABLED=0 go build -trimpath \
  -ldflags="-s -w -buildid=" -o "$bundle/bin/ynx-oracle-provider" ./cmd/ynx-oracle-provider
install -m 0644 "$ORACLE_PROVIDER_REGISTRY" "$bundle/config/providers.json"
install -m 0644 "$deployment_manifest" "$bundle/config/provider-deployment.json"
install -m 0755 scripts/verify/oracle-testnet-smoke.sh "$bundle/scripts/oracle-testnet-smoke.sh"

jq -n \
  --arg schema "ynx.oracle.testnet-release.v1" \
  --arg sourceCommit "$commit" \
  --arg release "$release" \
  --arg target "linux/$target_arch" \
  --arg nonceDomain "$ORACLE_NONCE_DOMAIN" \
  --arg apiDomain "$ORACLE_API_DOMAIN" \
  --arg publicOrigin "$ORACLE_PUBLIC_ORIGIN" \
  --arg sourceMode "$source_mode" \
  --slurpfile deployment "$deployment_manifest" \
  --slurpfile registry "$ORACLE_PROVIDER_REGISTRY" \
  '{
    schema: $schema,
    sourceCommit: $sourceCommit,
    release: $release,
    target: $target,
    nonceDomain: $nonceDomain,
    apiDomain: $apiDomain,
    publicOrigin: $publicOrigin,
    sourceMode: $sourceMode,
    providers: (
      if $sourceMode == "authoritative"
      then $deployment[0].providers
      else [$registry[0].candidates[] | {id, status, assetMarketCoverage}]
      end
    ),
    containsSecrets: false
  }' > "$bundle/config/release.json"

cat > "$bundle/systemd/ynx-oracled.service" <<EOF
[Unit]
Description=YNX Oracle & Market Data Testnet
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ynx-oracle
Group=ynx-oracle
EnvironmentFile=${ORACLE_REMOTE_ENV_PATH:-/etc/ynx-oracle/oracle.env}
ExecStart=/opt/ynx-oracle/current/bin/ynx-oracled --listen 127.0.0.1:6470 --metrics-listen 127.0.0.1:9470 --state /var/lib/ynx-oracle/state.json --providers /opt/ynx-oracle/current/config/providers.json --nonce-domain $ORACLE_NONCE_DOMAIN --public-origin $ORACLE_PUBLIC_ORIGIN
Restart=on-failure
RestartSec=5s
TimeoutStopSec=15s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
ReadWritePaths=/var/lib/ynx-oracle
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

provider_units=()
while IFS=$'\t' read -r provider_id adapter symbol market scale interval signer_path; do
  unit="ynx-oracle-provider-${provider_id}.service"
  provider_units+=("$unit")
  cat > "$bundle/systemd/$unit" <<EOF
[Unit]
Description=YNX Oracle Testnet Provider ${provider_id}
After=network-online.target ynx-oracled.service
Wants=network-online.target
Requires=ynx-oracled.service

[Service]
Type=simple
User=ynx-oracle
Group=ynx-oracle
ExecStart=/opt/ynx-oracle/current/bin/ynx-oracle-provider --providers /opt/ynx-oracle/current/config/providers.json --provider-id ${provider_id} --adapter ${adapter} --symbol ${symbol} --market ${market} --scale ${scale} --oracle http://127.0.0.1:6470 --signer ${signer_path} --sequence-state /var/lib/ynx-oracle/providers/${provider_id}.sequence --nonce-domain $ORACLE_NONCE_DOMAIN --interval ${interval}s
Restart=on-failure
RestartSec=5s
TimeoutStopSec=15s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
ReadOnlyPaths=${signer_path}
ReadWritePaths=/var/lib/ynx-oracle/providers
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
done < <(jq -r '.providers[] | [.id, .adapter, .symbol, .market, (.scale|tostring), (.intervalSeconds|tostring), .signerPath] | @tsv' "$deployment_manifest")

cat > "$bundle/caddy/ynx-oracle.caddy" <<EOF
$ORACLE_API_DOMAIN {
	encode zstd gzip
	@oracle_public {
		method GET
		path /health /version /prices /providers /markets /status /history /corrections /metrics /v1/prices /v1/index /v1/mark /v1/funding /v1/dex/twap /v1/dex/twap/replay /v1/stablecoin/reserve /v1/providers /v1/attestors /v1/markets /v1/status /v1/history /v1/corrections /v1/replay /v1/market-data
	}
	handle @oracle_public {
		reverse_proxy 127.0.0.1:6470
	}
	handle {
		respond 404
	}
}
EOF

(
  cd "$bundle"
  find . -type f ! -name SHA256SUMS -print | LC_ALL=C sort | while IFS= read -r file; do
    shasum -a 256 "$file"
  done > SHA256SUMS
)
output_dir="tmp/deploy"
mkdir -p "$output_dir"
tarball="$output_dir/${release}-linux-${target_arch}.tar.gz"
COPYFILE_DISABLE=1 tar --no-xattrs -C "$stage" -czf "$tarball" "$release"
chmod 0600 "$tarball"
tarball_sha="$(shasum -a 256 "$tarball" | awk '{print $1}')"
printf 'Oracle release bundle: %s\nSHA-256: %s\n' "$tarball" "$tarball_sha"

if [[ "${PACKAGE_ONLY:-0}" == "1" ]]; then
  exit 0
fi

remote="${SERVER_USER}@${SERVER_HOST}"
remote_tar="/tmp/$(basename "$tarball")"
remote_release="/opt/ynx-oracle/releases/$release"
remote_env="$ORACLE_REMOTE_ENV_PATH"
units_joined=""
if (( ${#provider_units[@]} > 0 )); then
  units_joined="${provider_units[*]}"
fi
rollback_command="set -e; previous=\$(sudo cat /var/lib/ynx-oracle/previous-release); if printf '%s\n' \"\$previous\" | grep -Eq '^/opt/ynx-oracle/releases/ynx-oracle-[0-9a-f]{40}$' && sudo test -d \"\$previous\"; then sudo rm -f /opt/ynx-oracle/current.previous; sudo ln -s \"\$previous\" /opt/ynx-oracle/current.previous; sudo mv -Tf /opt/ynx-oracle/current.previous /opt/ynx-oracle/current; test \"\$(readlink -f /opt/ynx-oracle/current)\" = \"\$previous\"; sudo systemctl restart ynx-oracled.service $units_joined; fi"

ynx_ssh "hostname >/dev/null && command -v systemctl >/dev/null && command -v caddy >/dev/null && command -v jq >/dev/null"
ynx_scp "$tarball" "$remote_tar"
ynx_ssh "set -e; test \$(stat -c '%a' '$remote_tar') = 600; printf '%s  %s\n' '$tarball_sha' '$remote_tar' | sha256sum -c -"
ynx_ssh "set -e; id -u ynx-oracle >/dev/null 2>&1 || sudo useradd --system --home /var/lib/ynx-oracle --shell /usr/sbin/nologin ynx-oracle; sudo install -d -o root -g root -m 0755 /opt/ynx-oracle/releases /etc/ynx-oracle; sudo install -d -o ynx-oracle -g ynx-oracle -m 0700 /var/lib/ynx-oracle /var/lib/ynx-oracle/providers"
ynx_ssh "set -e; sudo test -f '$remote_env'; sudo test ! -L '$remote_env'; sudo test \$(stat -c '%a' '$remote_env') = 600; sudo grep -Eq '^YNX_ORACLE_STATE_HMAC_KEY_HEX=[0-9a-fA-F]{64,}$' '$remote_env'"

while IFS= read -r signer_path; do
  ynx_ssh "set -e; sudo test -f '$signer_path'; sudo test ! -L '$signer_path'; sudo test \$(stat -c '%a' '$signer_path') = 600; sudo chown ynx-oracle:ynx-oracle '$signer_path'"
done < <(jq -r '.providers[].signerPath' "$deployment_manifest")

ynx_ssh "set -e; sudo rm -rf '$remote_release'; sudo mkdir -p '$remote_release'; sudo tar -xzf '$remote_tar' --strip-components=1 -C '$remote_release'; cd '$remote_release'; sha256sum -c SHA256SUMS; sudo chown -R root:root '$remote_release'; sudo chmod 0755 '$remote_release/bin/'*"
ynx_ssh "set -e; previous=''; if sudo test -L /opt/ynx-oracle/current; then candidate=\$(readlink -f /opt/ynx-oracle/current 2>/dev/null || true); if printf '%s\n' \"\$candidate\" | grep -Eq '^/opt/ynx-oracle/releases/ynx-oracle-[0-9a-f]{40}$' && sudo test -d \"\$candidate\"; then previous=\"\$candidate\"; fi; fi; sudo rm -f /opt/ynx-oracle/current.next; sudo ln -s '$remote_release' /opt/ynx-oracle/current.next; sudo mv -Tf /opt/ynx-oracle/current.next /opt/ynx-oracle/current; test \"\$(readlink -f /opt/ynx-oracle/current)\" = '$remote_release'; sudo install -m 0644 '$remote_release/systemd/ynx-oracled.service' /etc/systemd/system/ynx-oracled.service; for unit in $units_joined; do sudo install -m 0644 \"'$remote_release'/systemd/\$unit\" \"/etc/systemd/system/\$unit\"; done; sudo install -d -o root -g root -m 0755 /etc/caddy/conf.d; sudo install -m 0644 '$remote_release/caddy/ynx-oracle.caddy' /etc/caddy/conf.d/ynx-oracle.caddy; sudo grep -Eq '^[[:space:]]*import[[:space:]]+(/etc/caddy/)?conf\\.d/\\*\\.caddy' /etc/caddy/Caddyfile; sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; printf '%s' \"\$previous\" | sudo tee /var/lib/ynx-oracle/previous-release >/dev/null"

ynx_ssh "set -e; sudo bash -lc 'set -a; source \"$remote_env\"; set +a; runuser -u ynx-oracle --preserve-environment -- /opt/ynx-oracle/current/bin/ynx-oracled --state /var/lib/ynx-oracle/state.json --providers /opt/ynx-oracle/current/config/providers.json --nonce-domain \"$ORACLE_NONCE_DOMAIN\" --public-origin \"$ORACLE_PUBLIC_ORIGIN\" --check-config'; while IFS=\$'\\t' read -r id adapter symbol market scale interval signer; do sudo -u ynx-oracle /opt/ynx-oracle/current/bin/ynx-oracle-provider --providers /opt/ynx-oracle/current/config/providers.json --provider-id \"\$id\" --adapter \"\$adapter\" --symbol \"\$symbol\" --market \"\$market\" --scale \"\$scale\" --oracle http://127.0.0.1:6470 --signer \"\$signer\" --sequence-state \"/var/lib/ynx-oracle/providers/\$id.sequence\" --nonce-domain \"$ORACLE_NONCE_DOMAIN\" --interval \"\${interval}s\" --check-config; done < <(jq -r '.providers[] | [.id,.adapter,.symbol,.market,(.scale|tostring),(.intervalSeconds|tostring),.signerPath] | @tsv' /opt/ynx-oracle/current/config/provider-deployment.json)"
ynx_ssh "set -e; expected=' $units_joined '; for unit in \$(systemctl list-unit-files --no-legend 'ynx-oracle-provider-*.service' 2>/dev/null | awk '{print \$1}'); do case \"\$expected\" in *\" \$unit \"*) ;; *) sudo systemctl disable --now \"\$unit\" ;; esac; done; sudo systemctl daemon-reload; sudo systemctl enable ynx-oracled.service $units_joined; sudo systemctl restart ynx-oracled.service; for unit in $units_joined; do sudo systemctl restart \"\$unit\"; done; sudo systemctl reload caddy"

if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  ynx_ssh "$rollback_command"
  printf 'Oracle Testnet deployment dry run passed: release=%s source_mode=%s smoke_execution=%s\n' "$release" "$source_mode" "$smoke_execution"
  exit 0
fi

if [[ "$source_mode" == "authoritative" ]]; then
  test_market="$(jq -r '.providers[0].market' "$deployment_manifest")"
else
  test_market="$(jq -r '.candidates[0].assetMarketCoverage[0]' "$ORACLE_PROVIDER_REGISTRY")"
fi
smoke_passed=0
if [[ "$smoke_execution" == "remote" ]]; then
  printf -v remote_smoke_command 'NO_PROXY=%q ORACLE_RESOLVE_IP=%q bash %q %q %q %q %q' \
    '*' '127.0.0.1' "$remote_release/scripts/oracle-testnet-smoke.sh" \
    "https://$ORACLE_API_DOMAIN" "$commit" "$test_market" "$source_mode"
  if ynx_ssh "$remote_smoke_command"; then
    smoke_passed=1
  fi
elif bash scripts/verify/oracle-testnet-smoke.sh "https://$ORACLE_API_DOMAIN" "$commit" "$test_market" "$source_mode"; then
  smoke_passed=1
fi
if [[ "$smoke_passed" != "1" ]]; then
  ynx_ssh "$rollback_command"
  echo "Oracle public smoke failed; previous release was restored when available" >&2
  exit 1
fi

ynx_ssh "rm -f '$remote_tar'; sudo systemctl --no-pager --full status ynx-oracled.service $units_joined"
printf 'Oracle Testnet deployed: host=%s release=%s commit=%s source_mode=%s\n' "$remote" "$release" "$commit" "$source_mode"
