#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init

key_path="${CONSENSUS_CANDIDATE_TX_KEY:-}"
recipient="${CONSENSUS_CANDIDATE_TX_TO:-}"
amount="${CONSENSUS_CANDIDATE_TX_AMOUNT:-}"
nonce="${CONSENSUS_CANDIDATE_TX_NONCE:-}"
[[ -n "$key_path" && -f "$key_path" ]] || { echo "CONSENSUS_CANDIDATE_TX_KEY must reference an owner-controlled raw key file" >&2; exit 1; }
[[ "$recipient" =~ ^0x[0-9a-f]{40}$ ]] || { echo "CONSENSUS_CANDIDATE_TX_TO must be a canonical lowercase address" >&2; exit 1; }
[[ "$amount" =~ ^[1-9][0-9]*$ ]] || { echo "CONSENSUS_CANDIDATE_TX_AMOUNT must be positive" >&2; exit 1; }
[[ "$nonce" =~ ^[1-9][0-9]*$ ]] || { echo "CONSENSUS_CANDIDATE_TX_NONCE must be positive" >&2; exit 1; }
[[ "${CONSENSUS_CANDIDATE_SIGNED_TX_APPROVED:-}" == "yes" ]] || { echo "CONSENSUS_CANDIDATE_SIGNED_TX_APPROVED=yes is required" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
go run ./cmd/ynx-consensus-tx -key "$key_path" -chain-id 6423 -to "$recipient" -amount "$amount" -nonce "$nonce" >"$tmp/tx.json"
sender="$(node -e 'const tx=JSON.parse(require("fs").readFileSync(process.argv[1])); if(!/^0x[0-9a-f]{40}$/.test(tx.sender)) process.exit(1); process.stdout.write(tx.sender)' "$tmp/tx.json")"
[[ "$sender" != "$recipient" ]] || { echo "signed transaction sender and recipient must differ" >&2; exit 1; }

query_accounts() {
  local phase="$1"
  query_role() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5"
    mkdir -p "$tmp/$phase/$role"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS -G --data-urlencode 'path=\"/accounts/$sender\"' http://127.0.0.1:27757/abci_query" >"$tmp/$phase/$role/sender.json"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS -G --data-urlencode 'path=\"/accounts/$recipient\"' http://127.0.0.1:27757/abci_query" >"$tmp/$phase/$role/recipient.json"
  }
  ynx_ops_each_node query_role
}

query_accounts before
tx_hex="$(od -An -v -tx1 "$tmp/tx.json" | tr -d ' \n')"
broadcast_primary() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  [[ "$role" == "primary" ]] || return 0
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS -G --data-urlencode 'tx=0x$tx_hex' http://127.0.0.1:27757/broadcast_tx_commit" >"$tmp/broadcast.json"
}
ynx_ops_each_node broadcast_primary
query_accounts after

evidence_output="${CONSENSUS_CANDIDATE_TX_EVIDENCE:-tmp/consensus-candidate-signed-tx-evidence.json}"
mkdir -p "$(dirname "$evidence_output")"
node scripts/verify/consensus-candidate-tx-evidence.mjs "$tmp" "$sender" "$recipient" "$amount" "$nonce" "$evidence_output"

CONSENSUS_CANDIDATE_EVIDENCE_DIR="${CONSENSUS_CANDIDATE_EVIDENCE_DIR:-tmp/consensus-candidate-post-tx-evidence}" \
  bash scripts/verify/verify-consensus-candidate.sh
echo "candidate signed transaction evidence written to $evidence_output; signing key remained local and public cutover remains unauthorized"
