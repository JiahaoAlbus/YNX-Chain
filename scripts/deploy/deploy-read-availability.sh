#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh
ynx_load_env

dry_run="${DEPLOY_DRY_RUN:-0}"
if [[ "$dry_run" != "1" ]]; then
  ynx_require_env PRIMARY_NODE_HOST PRIMARY_NODE_USER PRIMARY_NODE_SSH_KEY \
    SG_NODE_HOST SG_NODE_USER SG_NODE_SSH_KEY \
    SILICON_VALLEY_NODE_HOST SILICON_VALLEY_NODE_USER SILICON_VALLEY_NODE_SSH_KEY \
    SEOUL_NODE_HOST SEOUL_NODE_USER SEOUL_NODE_SSH_KEY
  ynx_require_clean_worktree
fi

source_commit="$(git rev-parse HEAD)"
short_commit="${source_commit:0:12}"
release="ynx-read-availability-$short_commit"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
work="$(mktemp -d)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
mkdir -p "$work/package/bin"

ldflags="-s -w -X main.buildCommit=${source_commit} -X main.buildRelease=${release} -X main.buildTime=${build_time}"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$ldflags" -o "$work/package/bin/ynx-chaind" ./cmd/ynx-chaind
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$ldflags" -o "$work/package/bin/ynx-indexerd" ./cmd/ynx-indexerd
cp scripts/deploy/remote/install-read-availability.sh "$work/package/install.sh"
chmod 0755 "$work/package/install.sh"
(
  cd "$work/package"
  find bin -type f -print0 | sort -z | xargs -0 shasum -a 256 >SHA256SUMS
)
archive="$work/$release.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$work/package" .
chmod 0600 "$archive"
archive_hash="$(shasum -a 256 "$archive" | awk '{print $1}')"

if [[ "$dry_run" == "1" ]]; then
  bash -n scripts/deploy/remote/install-read-availability.sh
  grep -a -Fq "$source_commit" "$work/package/bin/ynx-chaind"
  grep -a -Fq "$source_commit" "$work/package/bin/ynx-indexerd"
  echo "read availability deployment dry-run passed: release=$release archiveSHA256=$archive_hash sequence=primary,singapore,silicon-valley,seoul"
  exit 0
fi

transport_ssh() {
  local role="$1" user="$2" host="$3" key="$4" proxy="$5" command="$6"
  local options=(-i "$key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10)
  if [[ "$proxy" == "primary" ]]; then
    options+=(-o "ProxyCommand=ssh -i $PRIMARY_NODE_SSH_KEY -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -W %h:%p $PRIMARY_NODE_USER@$PRIMARY_NODE_HOST")
  fi
  ynx_connection_retry "$role read availability ssh" ssh "${options[@]}" "$user@$host" "$command"
}

transport_scp() {
  local role="$1" user="$2" host="$3" key="$4" proxy="$5" source="$6" destination="$7"
  local options=(-i "$key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10)
  if [[ "$proxy" == "primary" ]]; then
    options+=(-o "ProxyCommand=ssh -i $PRIMARY_NODE_SSH_KEY -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -W %h:%p $PRIMARY_NODE_USER@$PRIMARY_NODE_HOST")
  fi
  ynx_connection_retry "$role read availability scp" scp "${options[@]}" "$source" "$user@$host:$destination"
}

deploy_role() {
  local role="$1" user="$2" host="$3" key="$4" proxy="$5" mode="$6"
  local remote_archive="/tmp/$release.tar.gz" remote_dir="/tmp/$release"
  transport_scp "$role" "$user" "$host" "$key" "$proxy" "$archive" "$remote_archive"
  transport_ssh "$role" "$user" "$host" "$key" "$proxy" \
    "set -euo pipefail; chmod 0600 '$remote_archive'; printf '%s  %s\\n' '$archive_hash' '$remote_archive' | sha256sum -c -; rm -rf '$remote_dir'; install -d -m 0700 '$remote_dir'; tar -xzf '$remote_archive' -C '$remote_dir'; rm -f '$remote_archive'; bash '$remote_dir/install.sh' '$remote_dir' '$release' '$source_commit' '$role' '$mode'; rm -rf '$remote_dir'"
}

echo "YNX_READ_AVAILABILITY_SEQUENCE=1 role=primary"
deploy_role primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" direct primary
echo "YNX_READ_AVAILABILITY_SEQUENCE=2 role=singapore"
deploy_role singapore "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY" direct validator
echo "YNX_READ_AVAILABILITY_SEQUENCE=3 role=silicon-valley"
deploy_role silicon-valley "$SILICON_VALLEY_NODE_USER" "${SILICON_VALLEY_PRIVATE_HOST:-10.77.42.3}" "$SILICON_VALLEY_NODE_SSH_KEY" primary validator
echo "YNX_READ_AVAILABILITY_SEQUENCE=4 role=seoul"
deploy_role seoul "$SEOUL_NODE_USER" "${SEOUL_PRIVATE_HOST:-10.77.42.4}" "$SEOUL_NODE_SSH_KEY" primary validator

echo "read availability Testnet deployment completed: release=$release sourceCommit=$source_commit"
