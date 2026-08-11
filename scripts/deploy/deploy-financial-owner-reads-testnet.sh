#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh

PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-43.153.202.237}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-ubuntu}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"
YNX_FINANCIAL_OWNER_READS_DRY_RUN="${YNX_FINANCIAL_OWNER_READS_DRY_RUN:-0}"
case "$YNX_FINANCIAL_OWNER_READS_DRY_RUN" in 0 | 1) ;; *) echo "YNX_FINANCIAL_OWNER_READS_DRY_RUN must be 0 or 1" >&2; exit 1 ;; esac
[[ -r "$PRIMARY_NODE_SSH_KEY" ]] || { echo "Primary Testnet SSH key is not readable" >&2; exit 1; }
ynx_require_clean_worktree

source_commit="$(git rev-parse HEAD)"
release="ynx-financial-owner-reads-${source_commit:0:12}"
work="$(mktemp -d "${TMPDIR:-/tmp}/ynx-financial-owner-reads.XXXXXX")"
trap 'rm -rf "$work"' EXIT
root="$work/$release"
mkdir -p "$root/exchange/bin" "$root/exchange/apps/exchange/web" "$root/quant/apps/quant-lab/web"

CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
  -ldflags "-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/exchangeproduct.BuildCommit=$source_commit" \
  -o "$root/exchange/bin/ynx-exchanged" ./apps/exchange/server
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
  -ldflags "-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=$source_commit" \
  -o "$root/quant/ynx-quant" ./apps/quant-lab/server
cp -R apps/exchange/web/. "$root/exchange/apps/exchange/web/"
cp -R apps/quant-lab/web/. "$root/quant/apps/quant-lab/web/"
install -m 0644 scripts/deploy/install-financial-owner-reads-testnet-remote.sh "$root/install-remote.sh"
find "$root" -type d -exec chmod 0755 {} +
find "$root" -type f -exec chmod 0644 {} +
chmod 0755 "$root/exchange/bin/ynx-exchanged" "$root/quant/ynx-quant"
if command -v xattr >/dev/null 2>&1; then xattr -cr "$root"; fi
(
  cd "$root"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)
exchange_sha="$(sha256sum "$root/exchange/bin/ynx-exchanged" | awk '{print $1}')"
quant_sha="$(sha256sum "$root/quant/ynx-quant" | awk '{print $1}')"
archive="$work/$release.tar.gz"
COPYFILE_DISABLE=1 tar -C "$work" -czf "$archive" "$release"
archive_sha="$(sha256sum "$archive" | awk '{print $1}')"
printf 'financialOwnerReadPackage=passed\nsourceCommit=%s\nexchangeSha256=%s\nquantSha256=%s\narchiveSha256=%s\n' "$source_commit" "$exchange_sha" "$quant_sha" "$archive_sha"
if [[ "$YNX_FINANCIAL_OWNER_READS_DRY_RUN" == "1" ]]; then echo "financialOwnerReadDeploy=dry-run"; exit 0; fi

remote="$PRIMARY_NODE_USER@$PRIMARY_NODE_HOST"
remote_archive="/tmp/$release.tar.gz"
remote_root="/opt/ynx/releases/financial-owner-reads/$release"
ynx_transport_scp "financial-owner-reads-primary" "$PRIMARY_NODE_SSH_KEY" "$archive" "$remote" "$remote_archive"
command="set -e
chmod 0600 '$remote_archive'
printf '%s  %s\\n' '$archive_sha' '$remote_archive' | sha256sum -c -
sudo install -d -o root -g root /opt/ynx/releases/financial-owner-reads
if sudo test -d '$remote_root'; then
  sudo bash -c \"cd '$remote_root' && sha256sum -c SHA256SUMS\"
else
  sudo tar -xzf '$remote_archive' -C /opt/ynx/releases/financial-owner-reads
  sudo chown -R root:root '$remote_root'
fi
sudo bash '$remote_root/install-remote.sh' '$remote_root' '$source_commit' '$exchange_sha' '$quant_sha'
rm -f '$remote_archive'"
ynx_transport_ssh "financial-owner-reads-primary" "$PRIMARY_NODE_SSH_KEY" "$remote" "$command"
