#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh
ynx_load_env

out="${YNX_UPGRADE_SOURCE_RELEASE_DIR:-tmp/verify-testnet/upgrade-source-release}"
evidence="${YNX_UPGRADE_SOURCE_RELEASE_EVIDENCE_PATH:-tmp/verify-testnet/upgrade-source-release-evidence.json}"
target_commit="${YNX_EXPECTED_RELEASE_COMMIT:-$(git rev-parse --short=12 HEAD)}"
target_release="${YNX_EXPECTED_RELEASE_NAME:-ynx-chain-${target_commit}}"
rm -rf "$out"
mkdir -p "$out"

collect_node() {
  local role="$1" user="$2" host="$3" key="$4"
  [[ -r "$key" ]] || { echo "$role SSH key is not readable" >&2; return 1; }
  ynx_transport_ssh "upgrade-source-$role" "$key" "$user@$host" 'bash -s' >"$out/$role.txt" <<'REMOTE'
set -euo pipefail
compact() { tr -d '[:space:]'; }
json_string() { printf '%s' "$2" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" | head -1; }
read_privileged() { if [[ -r "$1" ]]; then cat "$1"; else sudo -n cat "$1"; fi; }
sha_privileged() { if [[ -r "$1" ]]; then sha256sum "$1"; else sudo -n sha256sum "$1"; fi; }
status="$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:6420/status)"
status_compact="$(printf '%s' "$status" | compact)"
commit="$(json_string commit "$status_compact")"
release="$(json_string release "$status_compact")"
[[ "$commit" =~ ^[0-9a-f]{12}$ ]]
[[ "$release" == "ynx-chain-$commit" ]]
manifest="/opt/ynx-chain/releases/$release/config/release-manifest.json"
manifest_json="$(read_privileged "$manifest")"
manifest_compact="$(printf '%s' "$manifest_json" | compact)"
manifest_sha="$(sha_privileged "$manifest" | awk '{print $1}')"
chaind_sha="$(sha_privileged /usr/local/bin/ynx-chaind | awk '{print $1}')"
echo "statusEndpoint=ok"
echo "sourceCommit=$commit"
echo "sourceRelease=$release"
echo "sourceManifest=ok"
echo "sourceManifestSha256=$manifest_sha"
echo "sourceChaindSha256=$chaind_sha"
printf '%s' "$manifest_compact" | grep -Fq '"schema":"ynx-chain-release-manifest/v1"' && echo "sourceManifest.schema=ok"
printf '%s' "$manifest_compact" | grep -Fq "\"commit\":\"$commit\"" && echo "sourceManifest.commitMatchesStatus=ok"
printf '%s' "$manifest_compact" | grep -Fq "\"release\":\"$release\"" && echo "sourceManifest.releaseMatchesStatus=ok"
printf '%s' "$manifest_compact" | grep -Fq '"path":"bin/ynx-chaind"' && echo "sourceManifest.chaindPath=ok"
printf '%s' "$manifest_compact" | grep -Fq "\"sha256\":\"$chaind_sha\"" && echo "sourceManifest.chaindChecksum=ok"
REMOTE
}

collect_node primary "${PRIMARY_NODE_USER:-ubuntu}" "${PRIMARY_NODE_HOST:-43.153.202.237}" "${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"
collect_node singapore "${SG_NODE_USER:-root}" "${SG_NODE_HOST:-43.134.23.58}" "${SG_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"
collect_node silicon-valley "${SILICON_VALLEY_NODE_USER:-ubuntu}" "${SILICON_VALLEY_NODE_HOST:-43.162.100.54}" "${SILICON_VALLEY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang2.pem}"
collect_node seoul "${SEOUL_NODE_USER:-root}" "${SEOUL_NODE_HOST:-43.164.132.81}" "${SEOUL_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang3.pem}"

YNX_UPGRADE_SOURCE_RELEASE_EVIDENCE_PATH="$evidence" \
  node scripts/verify/upgrade-source-release-evidence.mjs "$out" "$target_commit" "$target_release"
