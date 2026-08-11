#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh

PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-43.153.202.237}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-ubuntu}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"
YNX_PAY_PRODUCT_TESTNET_DRY_RUN="${YNX_PAY_PRODUCT_TESTNET_DRY_RUN:-0}"
[[ "$YNX_PAY_PRODUCT_TESTNET_DRY_RUN" == "0" || "$YNX_PAY_PRODUCT_TESTNET_DRY_RUN" == "1" ]] || { echo "YNX_PAY_PRODUCT_TESTNET_DRY_RUN must be 0 or 1" >&2; exit 1; }
[[ -r "$PRIMARY_NODE_SSH_KEY" ]] || { echo "Primary Testnet SSH key is not readable" >&2; exit 1; }
if [[ "$YNX_PAY_PRODUCT_TESTNET_DRY_RUN" == "0" ]]; then ynx_require_clean_worktree; fi

source_commit="$(git rev-parse HEAD)"
short_commit="${source_commit:0:12}"
release="ynx-pay-product-$short_commit"
build_time="$(node -e 'process.stdout.write(new Date().toISOString())')"
work="$(mktemp -d "${TMPDIR:-/tmp}/ynx-pay-product-testnet.XXXXXX")"
trap 'rm -rf "$work"' EXIT
release_root="$work/$release"
mkdir -p "$release_root/bin"

build_flags="-s -w -X main.buildCommit=$source_commit -X main.buildRelease=$release -X main.buildTime=$build_time"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$build_flags" -o "$release_root/bin/ynx-pay-productd" ./internal/payproduct/cmd/ynx-pay-productd
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$build_flags" -o "$release_root/bin/ynx-app-gatewayd" ./cmd/ynx-app-gatewayd
install -m 0644 scripts/deploy/install-pay-product-testnet-remote.sh "$release_root/install-pay-product-testnet-remote.sh"
chmod 0755 "$release_root/bin/ynx-pay-productd" "$release_root/bin/ynx-app-gatewayd"
if command -v xattr >/dev/null 2>&1; then xattr -cr "$release_root"; fi
(
  cd "$release_root"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)
tarball="$work/$release.tar.gz"
COPYFILE_DISABLE=1 tar -C "$work" -czf "$tarball" "$release"
tarball_sha="$(sha256sum "$tarball" | awk '{print $1}')"
printf 'payProductPackage=passed\nrelease=%s\nsourceCommit=%s\narchiveSha256=%s\n' "$release" "$source_commit" "$tarball_sha"
if [[ "$YNX_PAY_PRODUCT_TESTNET_DRY_RUN" == "1" ]]; then echo "payProductDeploy=dry-run"; exit 0; fi

remote="$PRIMARY_NODE_USER@$PRIMARY_NODE_HOST"
remote_tarball="/tmp/$release.tar.gz"
remote_release_dir="/opt/ynx-chain/pay-product-releases/$release"
ynx_transport_scp "pay-product-primary" "$PRIMARY_NODE_SSH_KEY" "$tarball" "$remote" "$remote_tarball"
remote_command="set -e
chmod 0600 '$remote_tarball'
printf '%s  %s\\n' '$tarball_sha' '$remote_tarball' | sha256sum -c -
sudo install -d -o root -g root /opt/ynx-chain/pay-product-releases
if sudo test -d '$remote_release_dir'; then
  sudo bash -c \"cd '$remote_release_dir' && sha256sum -c SHA256SUMS\"
else
  sudo tar -xzf '$remote_tarball' -C /opt/ynx-chain/pay-product-releases
  sudo chown -R root:root '$remote_release_dir'
fi
sudo bash '$remote_release_dir/install-pay-product-testnet-remote.sh' '$remote_release_dir' '$source_commit' '$release' '$build_time'
rm -f '$remote_tarball'"
ynx_transport_ssh "pay-product-primary" "$PRIMARY_NODE_SSH_KEY" "$remote" "$remote_command"
