#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init

package_root="${CONSENSUS_CANDIDATE_PACKAGE:-}"
[[ -n "$package_root" && -d "$package_root" ]] || { echo "CONSENSUS_CANDIDATE_PACKAGE must reference a generated candidate package" >&2; exit 1; }
go run ./cmd/ynx-consensus-package -verify-package "$package_root"

evidence_root="${CONSENSUS_CANDIDATE_EVIDENCE_DIR:-tmp/consensus-candidate-evidence}"
rm -rf "$evidence_root"
mkdir -p "$evidence_root"

collect_status() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  mkdir -p "$evidence_root/$role"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:27757/status"
  else
    ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:27757/status" >"$evidence_root/$role/status.json"
  fi
}
ynx_ops_each_node collect_status

if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  echo "candidate evidence dry-run completed; no remote or public proof was generated"
  exit 0
fi

height="$(node -e 'const fs=require("fs"),p=process.argv[1],roles=["primary","singapore","silicon-valley","seoul"]; const hs=roles.map(r=>Number(JSON.parse(fs.readFileSync(`${p}/${r}/status.json`)).result.sync_info.latest_block_height)); if(hs.some(h=>!Number.isSafeInteger(h)||h<=1)) process.exit(1); process.stdout.write(String(Math.min(...hs)-1));' "$evidence_root")"

collect_common_evidence() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS 'http://127.0.0.1:27757/validators?height=$height'" >"$evidence_root/$role/validators.json"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:27757/net_info" >"$evidence_root/$role/net_info.json"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS 'http://127.0.0.1:27757/block?height=$height'" >"$evidence_root/$role/block.json"
}
ynx_ops_each_node collect_common_evidence

output="$evidence_root/consensus-candidate-evidence.json"
node scripts/verify/consensus-candidate-evidence.mjs "$package_root" "$evidence_root" "$output"
echo "candidate evidence written to $output; public cutover remains unauthorized"
