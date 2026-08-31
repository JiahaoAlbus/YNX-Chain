#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh

PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-43.153.202.237}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-ubuntu}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"
YNX_WALLET_GATEWAY_TESTNET_DRY_RUN="${YNX_WALLET_GATEWAY_TESTNET_DRY_RUN:-0}"
case "$YNX_WALLET_GATEWAY_TESTNET_DRY_RUN" in
  0 | 1) ;;
  *) echo "YNX_WALLET_GATEWAY_TESTNET_DRY_RUN must be 0 or 1" >&2; exit 1 ;;
esac
[[ -r "$PRIMARY_NODE_SSH_KEY" ]] || { echo "Primary Testnet SSH key is not readable" >&2; exit 1; }
if [[ "$YNX_WALLET_GATEWAY_TESTNET_DRY_RUN" == "0" ]]; then
  ynx_require_clean_worktree
fi

source_commit="$(git rev-parse HEAD)"
short_commit="${source_commit:0:12}"
release="ynx-wallet-gateway-$short_commit"
build_time="$(node -e 'process.stdout.write(new Date().toISOString())')"
work="$(mktemp -d "${TMPDIR:-/tmp}/ynx-wallet-gateway-testnet.XXXXXX")"
trap 'rm -rf "$work"' EXIT
release_root="$work/$release"
mkdir -p "$release_root/wallet-auth"

cp -R packages/wallet-auth/src "$release_root/wallet-auth/src"
cp -R packages/wallet-auth/scripts "$release_root/wallet-auth/scripts"
cp packages/wallet-auth/central-registry.json packages/wallet-auth/package.json packages/wallet-auth/package-lock.json "$release_root/wallet-auth/"
install -m 0644 scripts/deploy/install-wallet-gateway-testnet-remote.sh "$release_root/install-wallet-gateway-testnet-remote.sh"
(
  cd "$release_root/wallet-auth"
  npm ci --omit=dev --ignore-scripts
)
find "$release_root" -type d -exec chmod 0755 {} +
find "$release_root" -type f -exec chmod 0644 {} +
chmod 0755 "$release_root/wallet-auth/scripts/ynx-wallet-gatewayd.mjs"
if command -v xattr >/dev/null 2>&1; then xattr -cr "$release_root"; fi
registry_file_sha="$(sha256sum "$release_root/wallet-auth/central-registry.json" | awk '{print $1}')"
registry_runtime_sha="$(WALLET_REGISTRY_PATH="$release_root/wallet-auth/central-registry.json" node --input-type=module -e 'import {createHash} from "node:crypto"; import {readFileSync} from "node:fs"; import {canonicalJSON,parseCentralRegistryDocument} from "./packages/wallet-auth/src/index.js"; const value=parseCentralRegistryDocument(JSON.parse(readFileSync(process.env.WALLET_REGISTRY_PATH,"utf8"))); process.stdout.write(createHash("sha256").update(canonicalJSON(value)).digest("hex"))')"
(
  cd "$release_root"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

tarball="$work/$release.tar.gz"
COPYFILE_DISABLE=1 tar -C "$work" -czf "$tarball" "$release"
tarball_sha="$(sha256sum "$tarball" | awk '{print $1}')"
tar -tzf "$tarball" | grep -Fq "$release/wallet-auth/central-registry.json"
tar -tzf "$tarball" | grep -Fq "$release/wallet-auth/scripts/ynx-wallet-gatewayd.mjs"
printf 'walletGatewayPackage=passed\nrelease=%s\nsourceCommit=%s\nregistryFileSha256=%s\nregistryRuntimeSha256=%s\narchiveSha256=%s\n' "$release" "$source_commit" "$registry_file_sha" "$registry_runtime_sha" "$tarball_sha"

if [[ "$YNX_WALLET_GATEWAY_TESTNET_DRY_RUN" == "1" ]]; then
  echo "walletGatewayDeploy=dry-run"
  exit 0
fi

remote_tarball="/tmp/$release.tar.gz"
remote_release_dir="/opt/ynx-chain/wallet-releases/$release"
remote="$PRIMARY_NODE_USER@$PRIMARY_NODE_HOST"
ynx_transport_scp "wallet-gateway-primary" "$PRIMARY_NODE_SSH_KEY" "$tarball" "$remote" "$remote_tarball"
remote_command="set -e
chmod 0600 '$remote_tarball'
printf '%s  %s\\n' '$tarball_sha' '$remote_tarball' | sha256sum -c -
sudo install -d -o root -g root /opt/ynx-chain/wallet-releases
if sudo test -d '$remote_release_dir'; then
  sudo bash -c \"cd '$remote_release_dir' && sha256sum -c SHA256SUMS\"
else
  sudo tar -xzf '$remote_tarball' -C /opt/ynx-chain/wallet-releases
  sudo chown -R root:root '$remote_release_dir'
fi
sudo bash '$remote_release_dir/install-wallet-gateway-testnet-remote.sh' '$remote_release_dir' '$source_commit' '$release' '$build_time' '$registry_file_sha' '$registry_runtime_sha'
rm -f '$remote_tarball'"
ynx_transport_ssh "wallet-gateway-primary" "$PRIMARY_NODE_SSH_KEY" "$remote" "$remote_command"
