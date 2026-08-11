#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh

PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-43.153.202.237}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-ubuntu}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"
YNX_FINANCE_TESTNET_DRY_RUN="${YNX_FINANCE_TESTNET_DRY_RUN:-0}"
case "$YNX_FINANCE_TESTNET_DRY_RUN" in 0 | 1) ;; *) echo "YNX_FINANCE_TESTNET_DRY_RUN must be 0 or 1" >&2; exit 1 ;; esac
[[ -r "$PRIMARY_NODE_SSH_KEY" ]] || { echo "Primary Testnet SSH key is not readable" >&2; exit 1; }
ynx_require_clean_worktree

source_commit="$(git rev-parse HEAD)"
release="ynx-finance-${source_commit:0:12}"
build_time="$(node -e 'process.stdout.write(new Date().toISOString())')"
work="$(mktemp -d "${TMPDIR:-/tmp}/ynx-finance-testnet.XXXXXX")"
trap 'rm -rf "$work"' EXIT
release_root="$work/$release"
mkdir -p "$release_root/web"

CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
  -ldflags "-s -w -X main.buildCommit=$source_commit -X main.buildRelease=$release -X main.buildTime=$build_time" \
  -o "$release_root/ynx-finance" ./apps/finance/cmd/server
cp -R apps/finance/web/. "$release_root/web/"
install -m 0644 scripts/deploy/install-finance-testnet-remote.sh "$release_root/install-finance-testnet-remote.sh"
find "$release_root" -type d -exec chmod 0755 {} +
find "$release_root" -type f -exec chmod 0644 {} +
chmod 0755 "$release_root/ynx-finance"
if command -v xattr >/dev/null 2>&1; then xattr -cr "$release_root"; fi
binary_sha="$(sha256sum "$release_root/ynx-finance" | awk '{print $1}')"
web_sha="$(cd "$release_root/web" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
(
  cd "$release_root"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)
tarball="$work/$release.tar.gz"
COPYFILE_DISABLE=1 tar -C "$work" -czf "$tarball" "$release"
tarball_sha="$(sha256sum "$tarball" | awk '{print $1}')"
printf 'financePackage=passed\nrelease=%s\nsourceCommit=%s\nbinarySha256=%s\nwebTreeSha256=%s\narchiveSha256=%s\n' "$release" "$source_commit" "$binary_sha" "$web_sha" "$tarball_sha"
if [[ "$YNX_FINANCE_TESTNET_DRY_RUN" == "1" ]]; then echo "financeDeploy=dry-run"; exit 0; fi

remote="$PRIMARY_NODE_USER@$PRIMARY_NODE_HOST"
remote_tarball="/tmp/$release.tar.gz"
remote_release_dir="/opt/ynx/releases/finance/$release"
ynx_transport_scp "finance-primary" "$PRIMARY_NODE_SSH_KEY" "$tarball" "$remote" "$remote_tarball"
remote_command="set -e
chmod 0600 '$remote_tarball'
printf '%s  %s\\n' '$tarball_sha' '$remote_tarball' | sha256sum -c -
sudo install -d -o root -g root /opt/ynx/releases/finance
if sudo test -d '$remote_release_dir'; then
  sudo bash -c \"cd '$remote_release_dir' && sha256sum -c SHA256SUMS\"
else
  sudo tar -xzf '$remote_tarball' -C /opt/ynx/releases/finance
  sudo chown -R root:root '$remote_release_dir'
fi
sudo bash '$remote_release_dir/install-finance-testnet-remote.sh' '$remote_release_dir' '$source_commit' '$release' '$build_time' '$binary_sha' '$web_sha'
rm -f '$remote_tarball'"
ynx_transport_ssh "finance-primary" "$PRIMARY_NODE_SSH_KEY" "$remote" "$remote_command"
