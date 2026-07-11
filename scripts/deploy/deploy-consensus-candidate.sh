#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init

package_root="${CONSENSUS_CANDIDATE_PACKAGE:-}"
[[ -n "$package_root" && -d "$package_root" ]] || { echo "CONSENSUS_CANDIDATE_PACKAGE must reference a generated candidate package" >&2; exit 1; }
go run ./cmd/ynx-consensus-package -verify-package "$package_root"

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
  [[ "${CONSENSUS_CANDIDATE_APPROVED:-}" == "yes" ]] || { echo "CONSENSUS_CANDIDATE_APPROVED=yes is required" >&2; exit 1; }
  node scripts/verify/deploy-readiness-gate.mjs
fi

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-consensus-candidate-${commit}"
work_root="${CONSENSUS_CANDIDATE_WORK_ROOT:-tmp/consensus-candidate-deploy}"
work="$work_root/${release}"
rm -rf "$work"
mkdir -p "$work/bin" "$work/roles"

echo "building production candidate binaries for linux/amd64"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$work/bin/ynx-abci" ./cmd/ynx-abci
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$work/bin/ynx-consensus-keycheck" ./cmd/ynx-consensus-keycheck
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$work/bin/cometbft" github.com/cometbft/cometbft/cmd/cometbft

deploy_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local role_source="$package_root/roles/$role"
  [[ -d "$role_source" ]] || { echo "candidate package is missing role $role" >&2; return 1; }
  local stage="$work/roles/$role" archive="$work/${release}-${role}.tar.gz"
  rm -rf "$stage"
  mkdir -p "$stage/bin" "$stage/role"
  cp "$work/bin/ynx-abci" "$work/bin/ynx-consensus-keycheck" "$work/bin/cometbft" "$stage/bin/"
  cp -R "$role_source/." "$stage/role/"
  tar -czf "$archive" -C "$stage" .
  local archive_hash
  archive_hash="$(shasum -a 256 "$archive" | awk '{print $1}')"
  local remote_archive="/tmp/${release}-${role}.tar.gz" remote_dir="/opt/ynx-chain/consensus-candidates/${release}/${role}"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN [%s] scp -i %q %q %q:%q\n' "$role" "$key" "$archive" "$user@$host" "$remote_archive"
  else
    scp -i "$key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "$archive" "$user@$host:$remote_archive"
  fi
  ynx_ops_ssh "$role" "$user" "$host" "$key" "printf '%s  %s\\n' '$archive_hash' '$remote_archive' | sha256sum -c - && sudo rm -rf '$remote_dir' && sudo install -d -m 0700 '$remote_dir' && sudo tar -xzf '$remote_archive' -C '$remote_dir'"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo install -m 0755 '$remote_dir/bin/ynx-abci' /usr/local/bin/ynx-abci && sudo install -m 0755 '$remote_dir/bin/ynx-consensus-keycheck' /usr/local/bin/ynx-consensus-keycheck && sudo install -m 0755 '$remote_dir/bin/cometbft' /usr/local/bin/cometbft"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo /usr/local/bin/ynx-consensus-keycheck -role-manifest '$remote_dir/role/role-manifest.json' -private-validator-key '/etc/ynx/consensus-candidate/$role/priv_validator_key.json' -node-key '/etc/ynx/consensus-candidate/$role/node_key.json'"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "if sudo test -d /var/lib/ynx-chain/consensus-candidate; then sudo bash '$remote_dir/role/scripts/backup-candidate.sh' '/var/backups/ynx-chain/consensus-candidate-before-${release}-${role}.tar.gz'; fi"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo bash '$remote_dir/role/scripts/install-candidate.sh'"
}

ynx_ops_each_node deploy_candidate_role

verify_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local remote_dir="/opt/ynx-chain/consensus-candidates/${release}/${role}"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo bash '$remote_dir/role/scripts/verify-candidate.sh' && systemctl is-active ynx-chaind >/dev/null"
}

ynx_ops_each_node verify_candidate_role
echo "candidate deployment path completed for $release; public ingress and authoritative ynx-chaind remain unchanged"
