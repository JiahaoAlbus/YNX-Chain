#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh
ynx_load_env

dry_run="${DEPLOY_DRY_RUN:-0}"
PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-${SERVER_HOST:-43.153.202.237}}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-${SERVER_USER:-ubuntu}}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-${SSH_KEY_PATH:-/dev/null}}"
YNX_STABLE_RESERVE_DEPLOY_ENABLED="${YNX_STABLE_RESERVE_DEPLOY_ENABLED:-false}"
YNX_STABLE_RESERVE_ASSET="${YNX_STABLE_RESERVE_ASSET:-YUSD}"
YNX_STABLE_RESERVE_NETWORK="${YNX_STABLE_RESERVE_NETWORK:-ynx-testnet}"
YNX_ECONOMICS_EXPLORER_RELEASE_CLASS="${YNX_ECONOMICS_EXPLORER_RELEASE_CLASS:-central_testnet}"

[[ "$YNX_STABLE_RESERVE_DEPLOY_ENABLED" == "true" || "$YNX_STABLE_RESERVE_DEPLOY_ENABLED" == "false" ]] || {
  echo "YNX_STABLE_RESERVE_DEPLOY_ENABLED must be true or false"
  exit 1
}
[[ "$YNX_ECONOMICS_EXPLORER_RELEASE_CLASS" == "central_testnet" || "$YNX_ECONOMICS_EXPLORER_RELEASE_CLASS" == "public_testnet" ]] || {
  echo "YNX_ECONOMICS_EXPLORER_RELEASE_CLASS must be central_testnet or public_testnet"
  exit 1
}
if [[ "$YNX_ECONOMICS_EXPLORER_RELEASE_CLASS" == "public_testnet" ]]; then
  ynx_require_env EXPLORER_DOMAIN
  ynx_reject_unsafe_env_values EXPLORER_DOMAIN
fi
if [[ "$YNX_STABLE_RESERVE_DEPLOY_ENABLED" == "true" ]]; then
  ynx_require_env YNX_STABLE_RESERVE_ATTESTATION_PATH YNX_STABLE_RESERVE_PUBLIC_KEY YNX_STABLE_RESERVE_KEY_ID
  ynx_reject_unsafe_env_values YNX_STABLE_RESERVE_ATTESTATION_PATH YNX_STABLE_RESERVE_PUBLIC_KEY YNX_STABLE_RESERVE_KEY_ID YNX_STABLE_RESERVE_ASSET YNX_STABLE_RESERVE_NETWORK
  [[ -f "$YNX_STABLE_RESERVE_ATTESTATION_PATH" && ! -L "$YNX_STABLE_RESERVE_ATTESTATION_PATH" ]] || {
    echo "stable reserve attestation must be a regular non-symlink file"
    exit 1
  }
fi
reserve_mode="preserve"
if [[ "$YNX_STABLE_RESERVE_DEPLOY_ENABLED" == "true" ]]; then
  reserve_mode="configure"
fi
if [[ "$dry_run" != "1" ]]; then
  ynx_require_env PRIMARY_NODE_HOST PRIMARY_NODE_USER PRIMARY_NODE_SSH_KEY
  [[ -r "$PRIMARY_NODE_SSH_KEY" ]] || { echo "primary SSH key is not readable"; exit 1; }
  ynx_require_clean_worktree
fi

source_commit="$(git rev-parse HEAD)"
short_commit="${source_commit:0:12}"
release="ynx-economics-explorer-$short_commit"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
work="$(mktemp -d)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
mkdir -p "$work/package/bin" "$work/package/config" "$work/package/systemd"

ldflags="-s -w -X main.buildCommit=${source_commit} -X main.buildRelease=${release} -X main.buildTime=${build_time}"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$ldflags" -o "$work/package/bin/ynx-explorerd" ./cmd/ynx-explorerd

cat >"$work/package/config/ynx-explorerd.env" <<EOF
YNX_STABLE_RESERVE_DEPLOY_ENABLED=${YNX_STABLE_RESERVE_DEPLOY_ENABLED}
YNX_STABLE_RESERVE_ADAPTER_RELEASE_CLASS=${YNX_ECONOMICS_EXPLORER_RELEASE_CLASS}
YNX_YUSD_SANDBOX_URL=http://127.0.0.1:6490
EOF
if [[ "$YNX_STABLE_RESERVE_DEPLOY_ENABLED" == "true" ]]; then
  install -m 0600 "$YNX_STABLE_RESERVE_ATTESTATION_PATH" "$work/package/config/stable-reserve-attestation.json"
  printf 'YNX_STABLE_RESERVE_ATTESTATION_PATH=%q\n' "/etc/ynx/stable-reserve-attestation.json" >>"$work/package/config/ynx-explorerd.env"
  printf 'YNX_STABLE_RESERVE_PUBLIC_KEY=%q\n' "$YNX_STABLE_RESERVE_PUBLIC_KEY" >>"$work/package/config/ynx-explorerd.env"
  printf 'YNX_STABLE_RESERVE_KEY_ID=%q\n' "$YNX_STABLE_RESERVE_KEY_ID" >>"$work/package/config/ynx-explorerd.env"
  printf 'YNX_STABLE_RESERVE_ASSET=%q\n' "$YNX_STABLE_RESERVE_ASSET" >>"$work/package/config/ynx-explorerd.env"
  printf 'YNX_STABLE_RESERVE_NETWORK=%q\n' "$YNX_STABLE_RESERVE_NETWORK" >>"$work/package/config/ynx-explorerd.env"
  printf 'YNX_STABLE_RESERVE_SOURCE_COMMIT=%q\n' "$source_commit" >>"$work/package/config/ynx-explorerd.env"
fi
chmod 0600 "$work/package/config/ynx-explorerd.env"

cat >"$work/package/systemd/ynx-explorerd.service" <<'EOF'
[Unit]
Description=YNX Chain testnet explorer
After=network-online.target ynx-chaind.service ynx-indexerd.service ynx-yusd-sandboxd.service
Wants=network-online.target ynx-chaind.service ynx-indexerd.service ynx-yusd-sandboxd.service

[Service]
User=ynx
Group=ynx
EnvironmentFile=/etc/ynx/ynx-chaind.env
EnvironmentFile=/etc/ynx/ynx-explorerd.env
ExecStart=/usr/local/bin/ynx-explorerd
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/ynx-chain /var/log/ynx-chain

[Install]
WantedBy=multi-user.target
EOF

cp scripts/deploy/remote/install-economics-explorer.sh "$work/package/install.sh"
chmod 0755 "$work/package/install.sh"
(
  cd "$work/package"
  find bin config systemd -type f -print0 | sort -z | xargs -0 shasum -a 256 >SHA256SUMS
)
archive="$work/$release.tar.gz"
tar -czf "$archive" -C "$work/package" .
chmod 0600 "$archive"
archive_hash="$(shasum -a 256 "$archive" | awk '{print $1}')"

if [[ "$dry_run" == "1" ]]; then
  bash -n scripts/deploy/remote/install-economics-explorer.sh
  test -x "$work/package/bin/ynx-explorerd"
  grep -Fq 'EnvironmentFile=/etc/ynx/ynx-explorerd.env' "$work/package/systemd/ynx-explorerd.service"
  grep -Fq "YNX_STABLE_RESERVE_DEPLOY_ENABLED=$YNX_STABLE_RESERVE_DEPLOY_ENABLED" "$work/package/config/ynx-explorerd.env"
  grep -Fq 'YNX_YUSD_SANDBOX_URL=http://127.0.0.1:6490' "$work/package/config/ynx-explorerd.env"
  echo "scoped Explorer deployment dry-run passed: release=$release reserveConfigured=$YNX_STABLE_RESERVE_DEPLOY_ENABLED archiveSHA256=$archive_hash"
  exit 0
fi

remote="${PRIMARY_NODE_USER}@${PRIMARY_NODE_HOST}"
remote_archive="/tmp/$release.tar.gz"
remote_dir="/tmp/$release"
public_reserve_url="-"
public_yusd_url="-"
if [[ "$YNX_ECONOMICS_EXPLORER_RELEASE_CLASS" == "public_testnet" ]]; then
  public_reserve_url="https://${EXPLORER_DOMAIN}/api/stable/reserve"
  public_yusd_url="https://${EXPLORER_DOMAIN}/api/stable/yusd-sandbox"
fi
ynx_transport_scp economics-explorer-upload "$PRIMARY_NODE_SSH_KEY" "$archive" "$remote" "$remote_archive"
ynx_transport_ssh economics-explorer-stage "$PRIMARY_NODE_SSH_KEY" "$remote" \
  "set -euo pipefail; test \"\$(stat -c %a '$remote_archive')\" = 600; printf '%s  %s\\n' '$archive_hash' '$remote_archive' | sha256sum -c -; rm -rf '$remote_dir'; install -d -m 0700 '$remote_dir'; tar -xzf '$remote_archive' -C '$remote_dir'; rm -f '$remote_archive'"
ynx_transport_ssh economics-explorer-install "$PRIMARY_NODE_SSH_KEY" "$remote" \
  "bash '$remote_dir/install.sh' '$remote_dir' '$release' '$source_commit' '$reserve_mode' '$YNX_ECONOMICS_EXPLORER_RELEASE_CLASS' '$public_reserve_url' '$public_yusd_url'"
ynx_transport_ssh economics-explorer-cleanup "$PRIMARY_NODE_SSH_KEY" "$remote" "rm -rf '$remote_dir'"

echo "scoped Explorer Testnet deployment completed: release=$release sourceCommit=$source_commit"
