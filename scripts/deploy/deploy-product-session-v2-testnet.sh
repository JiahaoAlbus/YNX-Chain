#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh

PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-43.153.202.237}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-ubuntu}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"
YNX_PRODUCT_SESSION_V2_DEPLOY_MODE="${YNX_PRODUCT_SESSION_V2_DEPLOY_MODE:-dry-run}"
YNX_PRODUCT_SESSION_V2_DEPLOY_COMMIT="${YNX_PRODUCT_SESSION_V2_DEPLOY_COMMIT:-}"
case "$YNX_PRODUCT_SESSION_V2_DEPLOY_MODE" in dry-run | rollback-drill | deploy) ;; *) echo "YNX_PRODUCT_SESSION_V2_DEPLOY_MODE must be dry-run, rollback-drill or deploy" >&2; exit 1 ;; esac
[[ -r "$PRIMARY_NODE_SSH_KEY" ]] || { echo "Primary Testnet SSH key is not readable" >&2; exit 1; }
ynx_require_clean_worktree
source_commit="$(git rev-parse HEAD)"
[[ "$YNX_PRODUCT_SESSION_V2_DEPLOY_COMMIT" == "$source_commit" ]] || { echo "YNX_PRODUCT_SESSION_V2_DEPLOY_COMMIT must equal the exact clean HEAD" >&2; exit 1; }

short_commit="${source_commit:0:12}"
release="ynx-product-session-v2-$short_commit"
build_time="$(node -e 'process.stdout.write(new Date().toISOString())')"
work="$(mktemp -d "${TMPDIR:-/tmp}/ynx-product-session-v2.XXXXXX")"
trap 'rm -rf "$work"' EXIT
release_root="$work/$release"
mkdir -p "$release_root/wallet-auth"
cp -R packages/wallet-auth/src "$release_root/wallet-auth/src"
cp -R packages/wallet-auth/scripts "$release_root/wallet-auth/scripts"
cp packages/wallet-auth/product-session-registry.json packages/wallet-auth/package.json packages/wallet-auth/package-lock.json "$release_root/wallet-auth/"
install -m 0755 scripts/deploy/install-product-session-v2-testnet-remote.sh "$release_root/install-product-session-v2-testnet-remote.sh"
(
  cd "$release_root/wallet-auth"
  npm ci --omit=dev --ignore-scripts
)
find "$release_root" -type d -exec chmod 0755 {} +
find "$release_root" -type f -exec chmod 0644 {} +
chmod 0755 "$release_root/install-product-session-v2-testnet-remote.sh" "$release_root/wallet-auth/scripts/ynx-product-session-gatewayd.mjs" "$release_root/wallet-auth/scripts/probe-product-session-v2-public.mjs" "$release_root/wallet-auth/scripts/verify-product-session-v2-lifecycle.mjs"
if command -v xattr >/dev/null 2>&1; then xattr -cr "$release_root"; fi
registry_file_sha="$(sha256sum "$release_root/wallet-auth/product-session-registry.json" | awk '{print $1}')"
registry_runtime_sha="$(REGISTRY_PATH="$release_root/wallet-auth/product-session-registry.json" node --input-type=module -e 'import {createHash} from "node:crypto"; import {readFileSync} from "node:fs"; import {canonicalJSON} from "./packages/wallet-auth/src/canonical.js"; import {parseProductSessionRegistry} from "./packages/wallet-auth/src/product-session-registry.js"; const value=parseProductSessionRegistry(JSON.parse(readFileSync(process.env.REGISTRY_PATH,"utf8"))); process.stdout.write(createHash("sha256").update(canonicalJSON(value)).digest("hex"))')"
(
  cd "$release_root"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)
tarball="$work/$release.tar.gz"
COPYFILE_DISABLE=1 tar -C "$work" -czf "$tarball" "$release"
archive_sha="$(sha256sum "$tarball" | awk '{print $1}')"
printf 'productSessionV2Package=passed\nmode=%s\nrelease=%s\nsourceCommit=%s\nregistryFileSha256=%s\nregistryRuntimeSha256=%s\narchiveSha256=%s\n' "$YNX_PRODUCT_SESSION_V2_DEPLOY_MODE" "$release" "$source_commit" "$registry_file_sha" "$registry_runtime_sha" "$archive_sha"
if [[ "$YNX_PRODUCT_SESSION_V2_DEPLOY_MODE" == "dry-run" ]]; then exit 0; fi

remote="$PRIMARY_NODE_USER@$PRIMARY_NODE_HOST"
remote_tarball="/tmp/$release.tar.gz"
remote_release_dir="/opt/ynx-chain/product-session-releases/$release"
ynx_transport_scp "product-session-v2-primary" "$PRIMARY_NODE_SSH_KEY" "$tarball" "$remote" "$remote_tarball"
remote_command="set -e
chmod 0600 '$remote_tarball'
printf '%s  %s\\n' '$archive_sha' '$remote_tarball' | sha256sum -c -
sudo install -d -o root -g root /opt/ynx-chain/product-session-releases
if sudo test -d '$remote_release_dir'; then
  sudo bash -c \"cd '$remote_release_dir' && sha256sum -c SHA256SUMS\"
else
  sudo tar -xzf '$remote_tarball' -C /opt/ynx-chain/product-session-releases
  sudo chown -R root:root '$remote_release_dir'
fi
rm -f '$remote_tarball'
sudo bash '$remote_release_dir/install-product-session-v2-testnet-remote.sh' '$remote_release_dir' '$source_commit' '$release' '$build_time' '$registry_file_sha' '$registry_runtime_sha' '$YNX_PRODUCT_SESSION_V2_DEPLOY_MODE'"
ynx_transport_ssh "product-session-v2-primary" "$PRIMARY_NODE_SSH_KEY" "$remote" "$remote_command"
