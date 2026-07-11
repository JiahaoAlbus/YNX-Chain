#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init

records="${CONSENSUS_OVERLAY_PUBLIC_RECORDS:-tmp/consensus-overlay-key-ceremony/public}"
[[ -d "$records" ]] || { echo "CONSENSUS_OVERLAY_PUBLIC_RECORDS directory is required" >&2; exit 1; }
if [[ "${DEPLOY_DRY_RUN:-0}" != "1" && "${CONSENSUS_OVERLAY_DEPLOY_APPROVED:-}" != "yes" ]]; then
  echo "CONSENSUS_OVERLAY_DEPLOY_APPROVED=yes is required" >&2
  exit 1
fi

commit="$(git rev-parse --short=12 HEAD)"
work="${CONSENSUS_OVERLAY_WORK_ROOT:-tmp/consensus-overlay-deploy}"
rm -rf "$work"
node scripts/deploy/build-consensus-overlay-package.mjs "$records" "$work/package" >/dev/null

deploy_overlay_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local role_root="$work/package/roles/$role" remote_root="/opt/ynx-chain/consensus-overlay/$commit/$role" archive="$work/$role.tar.gz"
  tar -czf "$archive" -C "$role_root" .
  local archive_hash remote_archive="/tmp/ynx-consensus-overlay-${commit}-${role}.tar.gz"
  archive_hash="$(shasum -a 256 "$archive" | awk '{print $1}')"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN [%s] scp -i %q %q %q:%q\n' "$role" "$key" "$archive" "$user@$host" "$remote_archive"
  else
    scp -i "$key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "$archive" "$user@$host:$remote_archive"
  fi
  ynx_ops_ssh "$role" "$user" "$host" "$key" "printf '%s  %s\\n' '$archive_hash' '$remote_archive' | sha256sum -c - && sudo rm -rf '$remote_root' && sudo install -d -m 0700 '$remote_root' && sudo tar -xzf '$remote_archive' -C '$remote_root' && sudo install -m 0755 '$remote_root/ynx-consensus-overlay-up' /usr/local/sbin/ynx-consensus-overlay-up && sudo install -m 0644 '$remote_root/ynx-consensus-overlay.service' /etc/systemd/system/ynx-consensus-overlay.service && sudo systemctl daemon-reload && sudo systemctl enable --now ynx-consensus-overlay.service && systemctl is-active ynx-chaind >/dev/null"
}
ynx_ops_each_node deploy_overlay_role

if ! CONSENSUS_OVERLAY_PACKAGE="$work/package" ENV_FILE="${ENV_FILE:-}" bash scripts/verify/verify-consensus-overlay.sh; then
  stop_overlay_role() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo systemctl disable --now ynx-consensus-overlay.service || true; systemctl is-active ynx-chaind >/dev/null"
  }
  ynx_ops_each_node stop_overlay_role
  echo "overlay verification failed; candidate overlay stopped on all roles" >&2
  exit 1
fi
echo "consensus overlay deployed and privately reachable; authoritative ynx-chaind remained active"
