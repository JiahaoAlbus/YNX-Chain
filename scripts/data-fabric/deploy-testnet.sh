#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh
ynx_load_env

SERVER_HOST="${YNX_DATA_FABRIC_TESTNET_HOST:-${PRIMARY_NODE_HOST:-${SERVER_HOST:-}}}"
SERVER_USER="${YNX_DATA_FABRIC_TESTNET_USER:-${PRIMARY_NODE_USER:-${SERVER_USER:-}}}"
SSH_KEY_PATH="${YNX_DATA_FABRIC_TESTNET_SSH_KEY:-${PRIMARY_NODE_SSH_KEY:-${SSH_KEY_PATH:-}}}"
operator_env="${YNX_DATA_FABRIC_OPERATOR_ENV:-}"
event_keys="${YNX_DATA_FABRIC_EVENT_KEYS_INPUT:-}"
ynx_require_env SERVER_HOST SERVER_USER SSH_KEY_PATH YNX_DATA_FABRIC_OPERATOR_ENV YNX_DATA_FABRIC_EVENT_KEYS_INPUT
ynx_reject_unsafe_env_values SERVER_HOST SERVER_USER
[[ -r "$operator_env" && -r "$event_keys" ]] || { echo "operator env and event key registry must be readable" >&2; exit 1; }

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
  [[ "${YNX_DATA_FABRIC_TESTNET_DEPLOY_APPROVED:-}" == "yes" ]] || { echo "YNX_DATA_FABRIC_TESTNET_DEPLOY_APPROVED=yes is required" >&2; exit 1; }
  [[ -r "$SSH_KEY_PATH" ]] || { echo "Data Fabric Testnet SSH key is not readable" >&2; exit 1; }
  ynx_require_clean_worktree
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
commit="$(git rev-parse --short=12 HEAD)"
release="ynx-data-fabric-${commit}"
package_dir="$tmp/public-testnet"
scripts/data-fabric/package-public-testnet-release.sh "$package_dir" >/dev/null
stage="$package_dir/build/$release"
archive="$package_dir/${release}-linux-amd64.tar.gz"
index="$package_dir/${release}-release-index.json"
[[ -d "$stage" && -r "$archive" && -r "$index" ]] || { echo "immutable Testnet release package is incomplete" >&2; exit 1; }
node scripts/data-fabric/verify-public-testnet-release.mjs "$package_dir" "$commit" "$release" >/dev/null
"$stage/scripts/install-testnet-release.sh" --dry-run "$stage" "$operator_env" "$event_keys" >/dev/null

chmod 0600 "$archive"
chmod 0600 "$index"
archive_sha="$(jq -er '.artifact.sha256 | select(test("^[0-9a-f]{64}$"))' "$index")"
archive_bytes="$(jq -er '.artifact.bytes | select(type == "number" and . > 0 and floor == .)' "$index")"
index_sha="$(sha256sum "$index" | awk '{print $1}')"
[[ "$(wc -c < "$archive" | tr -d ' ')" == "$archive_bytes" ]] || { echo "Testnet release archive byte count is invalid" >&2; exit 1; }
printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum -c - >/dev/null
[[ "$index_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "Testnet release index checksum is invalid" >&2; exit 1; }
if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
  tar -xOf "$archive" "$release/provenance.json" | jq -e '.source.trackedTreeClean == true' >/dev/null ||
    { echo "deployment archive provenance is not built from a clean tracked tree" >&2; exit 1; }
fi

remote_archive="/tmp/${release}-linux-amd64.tar.gz"
remote_index="/tmp/${release}-release-index.json"
remote_env="/tmp/${release}.operator.env"
remote_keys="/tmp/${release}.event-keys.json"
remote_dir="/opt/ynx-data-fabric/releases/${release}"
remote="${SERVER_USER}@${SERVER_HOST}"

ynx_scp "$archive" "$remote_archive"
ynx_scp "$index" "$remote_index"
ynx_scp "$operator_env" "$remote_env"
ynx_scp "$event_keys" "$remote_keys"
ynx_ssh "set -euo pipefail; trap 'rm -f \"$remote_archive\" \"$remote_index\" \"$remote_env\" \"$remote_keys\"' EXIT; chmod 0600 '$remote_archive' '$remote_index' '$remote_env' '$remote_keys'; printf '%s  %s\\n' '$archive_sha' '$remote_archive' | sha256sum -c -; printf '%s  %s\\n' '$index_sha' '$remote_index' | sha256sum -c -; sudo rm -rf '$remote_dir'; sudo install -d -m 0700 '$remote_dir'; sudo tar --strip-components=1 -xzf '$remote_archive' -C '$remote_dir'; sudo install -m 0644 '$remote_index' '$remote_dir/public-testnet-release-index.json'; sudo '$remote_dir/scripts/remote-install-testnet-release.sh' '$remote_dir' '$remote_env' '$remote_keys'"

printf 'deployment command completed release=%s commit=%s remote=%s archiveBytes=%s archiveSha256=%s indexSha256=%s\n' "$release" "$commit" "$remote" "$archive_bytes" "$archive_sha" "$index_sha"
