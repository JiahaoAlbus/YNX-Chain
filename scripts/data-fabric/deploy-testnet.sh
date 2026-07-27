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
stage="$(scripts/data-fabric/build-testnet-release.sh "$tmp")"
commit="$(git rev-parse --short=12 HEAD)"
release="ynx-data-fabric-${commit}"
[[ "$stage" == "$tmp/$release" ]] || { echo "unexpected Testnet release stage" >&2; exit 1; }
"$stage/scripts/install-testnet-release.sh" --dry-run "$stage" "$operator_env" "$event_keys" >/dev/null

archive="$tmp/${release}.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$stage" .
chmod 0600 "$archive"
archive_sha="$(sha256sum "$archive" | awk '{print $1}')"
[[ "$archive_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "Testnet release archive checksum is invalid" >&2; exit 1; }

remote_archive="/tmp/${release}.tar.gz"
remote_env="/tmp/${release}.operator.env"
remote_keys="/tmp/${release}.event-keys.json"
remote_dir="/opt/ynx-data-fabric/releases/${release}"
remote="${SERVER_USER}@${SERVER_HOST}"

ynx_scp "$archive" "$remote_archive"
ynx_scp "$operator_env" "$remote_env"
ynx_scp "$event_keys" "$remote_keys"
ynx_ssh "set -euo pipefail; trap 'rm -f \"$remote_archive\" \"$remote_env\" \"$remote_keys\"' EXIT; chmod 0600 '$remote_archive' '$remote_env' '$remote_keys'; printf '%s  %s\\n' '$archive_sha' '$remote_archive' | sha256sum -c -; sudo rm -rf '$remote_dir'; sudo install -d -m 0700 '$remote_dir'; sudo tar -xzf '$remote_archive' -C '$remote_dir'; sudo '$remote_dir/scripts/remote-install-testnet-release.sh' '$remote_dir' '$remote_env' '$remote_keys'"

printf 'deployment command completed release=%s commit=%s remote=%s archiveSha256=%s\n' "$release" "$commit" "$remote" "$archive_sha"
