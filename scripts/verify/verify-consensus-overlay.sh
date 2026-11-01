#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init

package="${CONSENSUS_OVERLAY_PACKAGE:-}"
[[ -d "$package/roles" ]] || { echo "CONSENSUS_OVERLAY_PACKAGE is required" >&2; exit 1; }
# Preserve the normal relative package selector. abspath removes only relative
# spelling; the public reader still refuses every symlink/canonical mismatch.
package="$(python3 -B -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$package")"
manifest_pin="${CONSENSUS_OVERLAY_PACKAGE_MANIFEST_SHA256:-}"
[[ "$manifest_pin" =~ ^[0-9a-f]{64}$ && "$manifest_pin" != "$(printf '0%.0s' {1..64})" ]] || {
  echo "independent CONSENSUS_OVERLAY_PACKAGE_MANIFEST_SHA256 is required" >&2; exit 1;
}
export YNX_DEPLOY_CONNECTION_ATTEMPTS=1

verify_overlay_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5" program receipt
  program="$(python3 -B scripts/verify/consensus_overlay_public.py emit "$package" "$manifest_pin" "$role")"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "/usr/bin/timeout --signal=TERM --kill-after=1 30 /usr/bin/python3 -B -" <<<"$program"
    return
  fi
  receipt="$(ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo -n /usr/bin/timeout --signal=TERM --kill-after=1 30 /usr/bin/python3 -B -" <<<"$program")"
  printf '%s\n' "$receipt" | python3 -B scripts/verify/consensus_overlay_public.py check "$package" "$manifest_pin" "$role"
}
ynx_ops_each_node verify_overlay_role
if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  echo "consensus overlay verification dry-run completed; no remote reachability evidence was generated"
else
  echo "consensus overlay verification passed: four roles, exact independent peer sets, three normal ping peers via ynxwg0 each; no Node/signer readiness or activation claimed"
fi
