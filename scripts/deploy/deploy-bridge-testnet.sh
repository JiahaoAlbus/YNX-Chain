#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh

PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-43.153.202.237}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-ubuntu}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"
YNX_BRIDGE_TESTNET_DRY_RUN="${YNX_BRIDGE_TESTNET_DRY_RUN:-0}"
case "$YNX_BRIDGE_TESTNET_DRY_RUN" in
  0 | 1) ;;
  *) echo "YNX_BRIDGE_TESTNET_DRY_RUN must be 0 or 1" >&2; exit 1 ;;
esac
[[ -r "$PRIMARY_NODE_SSH_KEY" ]] || { echo "Primary Testnet SSH key is not readable" >&2; exit 1; }
if [[ "$YNX_BRIDGE_TESTNET_DRY_RUN" == "0" ]]; then
  ynx_require_clean_worktree
fi

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-bridge-$commit"
build_time="$(git show -s --format=%cI HEAD)"
work="$(mktemp -d "${TMPDIR:-/tmp}/ynx-bridge-testnet.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/$release/bin" "$work/$release/systemd" "$work/$release/scripts"

service_ldflags="-s -w -X main.buildCommit=${commit} -X main.buildRelease=${release} -X main.buildTime=${build_time}"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$service_ldflags" -o "$work/$release/bin/ynx-bridged" ./cmd/ynx-bridged
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$service_ldflags" -o "$work/$release/bin/ynx-app-gatewayd" ./cmd/ynx-app-gatewayd
install -m 0644 scripts/deploy/check-local-services.sh "$work/$release/scripts/check-local-services.sh"
install -m 0644 scripts/deploy/install-bridge-testnet-remote.sh "$work/$release/scripts/install-bridge-testnet-remote.sh"
cat >"$work/$release/systemd/ynx-bridged.service" <<'EOF'
[Unit]
Description=YNX Bridge Testnet coordinator (external execution disabled)
After=network-online.target
Wants=network-online.target

[Service]
User=ynx
Group=ynx
EnvironmentFile=/etc/ynx/ynx-bridged.env
ExecStart=/usr/local/bin/ynx-bridged
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/ynx-chain/bridge

[Install]
WantedBy=multi-user.target
EOF

(
  cd "$work/$release"
  sha256sum bin/ynx-bridged bin/ynx-app-gatewayd systemd/ynx-bridged.service scripts/check-local-services.sh scripts/install-bridge-testnet-remote.sh >SHA256SUMS
)
tarball="$work/$release.tar.gz"
tar -C "$work" -czf "$tarball" "$release"
tar_sha="$(sha256sum "$tarball" | awk '{print $1}')"
tar -tzf "$tarball" | grep -Fq "$release/bin/ynx-bridged"
tar -tzf "$tarball" | grep -Fq "$release/bin/ynx-app-gatewayd"
tar -tzf "$tarball" | grep -Fq "$release/scripts/install-bridge-testnet-remote.sh"

printf 'bridgeTestnetPackage=passed\nrelease=%s\ncommit=%s\nsha256=%s\n' "$release" "$commit" "$tar_sha"
if [[ "$YNX_BRIDGE_TESTNET_DRY_RUN" == "1" ]]; then
  echo "bridgeTestnetDeploy=dry-run"
  exit 0
fi

remote_tarball="/tmp/$release.tar.gz"
remote_release_dir="/opt/ynx-chain/bridge-releases/$release"
ynx_transport_scp "bridge-primary" "$PRIMARY_NODE_SSH_KEY" "$tarball" "$PRIMARY_NODE_USER@$PRIMARY_NODE_HOST" "$remote_tarball"
remote_command="set -e
chmod 0600 '$remote_tarball'
printf '%s  %s\\n' '$tar_sha' '$remote_tarball' | sha256sum -c -
sudo install -d -o root -g root /opt/ynx-chain/bridge-releases
if sudo test -d '$remote_release_dir'; then
  sudo bash -c \"cd '$remote_release_dir' && sha256sum -c SHA256SUMS\"
else
  sudo tar -xzf '$remote_tarball' -C /opt/ynx-chain/bridge-releases
  sudo chown -R root:root '$remote_release_dir'
fi
sudo bash '$remote_release_dir/scripts/install-bridge-testnet-remote.sh' '$remote_release_dir' '$commit' '$release'
rm -f '$remote_tarball'"
ynx_transport_ssh "bridge-primary" "$PRIMARY_NODE_SSH_KEY" "$PRIMARY_NODE_USER@$PRIMARY_NODE_HOST" "$remote_command"
