#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init

package_root="${CONSENSUS_CANDIDATE_PACKAGE:-}"
[[ -n "$package_root" && -d "$package_root" ]] || { echo "CONSENSUS_CANDIDATE_PACKAGE must reference a generated candidate package" >&2; exit 1; }
go run ./cmd/ynx-consensus-package -verify-package "$package_root"

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
  [[ "${CONSENSUS_CANDIDATE_APPROVED:-}" == "yes" ]] || { echo "CONSENSUS_CANDIDATE_APPROVED=yes is required" >&2; exit 1; }
  bash scripts/verify/consensus-candidate-deploy-gate.sh
fi

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-consensus-candidate-${commit}"
work_root="${CONSENSUS_CANDIDATE_WORK_ROOT:-tmp/consensus-candidate-deploy}"
work="$work_root/${release}"
rm -rf "$work"
mkdir -p "$work/bin" "$work/roles"

echo "building production candidate binaries for linux/amd64"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
bft_gateway_ldflags="-s -w -X main.buildCommit=${commit} -X main.buildRelease=ynx-bft-gateway-${commit} -X main.buildTime=${build_time}"
service_ldflags="-s -w -X main.buildCommit=${commit} -X main.buildRelease=ynx-chain-${commit} -X main.buildTime=${build_time}"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$work/bin/ynx-abci" ./cmd/ynx-abci
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$work/bin/ynx-consensus-keycheck" ./cmd/ynx-consensus-keycheck
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$work/bin/cometbft" github.com/cometbft/cometbft/cmd/cometbft
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$bft_gateway_ldflags" -o "$work/bin/ynx-bft-gatewayd" ./cmd/ynx-bft-gatewayd
for service in ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced; do
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$service_ldflags" -o "$work/bin/$service" "./cmd/$service"
done

candidate_mutation_started=0
deployment_complete=0
cleanup_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo systemctl disable --now ynx-consensus-comet-candidate.service ynx-consensus-abci-candidate.service 2>/dev/null || true; sudo rm -rf /var/lib/ynx-chain/consensus-candidate '/opt/ynx-chain/consensus-candidates/$release/$role'; rm -f '/tmp/$release-$role.tar.gz'; sudo rm -f /etc/systemd/system/ynx-consensus-comet-candidate.service /etc/systemd/system/ynx-consensus-abci-candidate.service; sudo systemctl daemon-reload; systemctl is-active ynx-chaind >/dev/null"
}
cleanup_failed_candidate_deploy() {
  local status="$?"
  trap - EXIT
  if [[ "$status" != "0" && "$candidate_mutation_started" == "1" && "$deployment_complete" == "0" ]]; then
    set +e
    ynx_ops_each_node cleanup_candidate_role
    echo "candidate deployment failed; parallel candidate services and state removed from all roles" >&2
  fi
  exit "$status"
}
trap cleanup_failed_candidate_deploy EXIT

deploy_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local role_source="$package_root/roles/$role"
  [[ -d "$role_source" ]] || { echo "candidate package is missing role $role" >&2; return 1; }
  local stage="$work/roles/$role" archive="$work/${release}-${role}.tar.gz"
  rm -rf "$stage"
  mkdir -p "$stage/bin" "$stage/role"
  cp "$work/bin/ynx-abci" "$work/bin/ynx-consensus-keycheck" "$work/bin/cometbft" "$stage/bin/"
  if [[ "$role" == "primary" ]]; then
    cp "$work/bin/ynx-bft-gatewayd" "$work/bin/ynx-indexerd" "$work/bin/ynx-explorerd" "$work/bin/ynx-faucetd" "$work/bin/ynx-ai-gatewayd" "$work/bin/ynx-payd" "$work/bin/ynx-trustd" "$work/bin/ynx-resourced" "$stage/bin/"
  fi
  cp -R "$role_source/." "$stage/role/"
  tar -czf "$archive" -C "$stage" .
  chmod 0600 "$archive"
  local archive_hash
  archive_hash="$(shasum -a 256 "$archive" | awk '{print $1}')"
  local remote_archive="/tmp/${release}-${role}.tar.gz" remote_dir="/opt/ynx-chain/consensus-candidates/${release}/${role}"
  ynx_ops_copy "$role" "$user" "$host" "$key" "$archive" "$remote_archive"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail; trap 'rm -f \"$remote_archive\"' EXIT; test \"\$(stat -c %a '$remote_archive')\" = 600; printf '%s  %s\\n' '$archive_hash' '$remote_archive' | sha256sum -c -; sudo rm -rf '$remote_dir'; sudo install -d -m 0700 '$remote_dir'; sudo tar -xzf '$remote_archive' -C '$remote_dir'"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo '$remote_dir/bin/ynx-consensus-keycheck' -role-manifest '$remote_dir/role/role-manifest.json' -private-validator-key '/etc/ynx/consensus-candidate/$role/priv_validator_key.json' -node-key '/etc/ynx/consensus-candidate/$role/node_key.json'"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "if sudo test -d /var/lib/ynx-chain/consensus-candidate; then sudo bash '$remote_dir/role/scripts/backup-candidate.sh' '/var/backups/ynx-chain/consensus-candidate-before-${release}-${role}.tar.gz'; fi"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo bash '$remote_dir/role/scripts/install-candidate.sh'"
  if [[ "$role" == "primary" ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "for service in ynx-bft-gatewayd ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced; do sudo install -m 0755 -o root -g root '$remote_dir/bin/'\"\$service\" '/var/lib/ynx-chain/consensus-candidate/bin/'\"\$service\"; done"
  fi
}

[[ "${DEPLOY_DRY_RUN:-0}" == "1" ]] || candidate_mutation_started=1
ynx_ops_each_node deploy_candidate_role

verify_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local remote_dir="/opt/ynx-chain/consensus-candidates/${release}/${role}"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo bash '$remote_dir/role/scripts/verify-candidate.sh' && systemctl is-active ynx-chaind >/dev/null && test ! -e '/tmp/${release}-${role}.tar.gz'"
}

ynx_ops_each_node verify_candidate_role
deployment_complete=1
echo "candidate deployment path completed for $release; public ingress and authoritative ynx-chaind remain unchanged"
