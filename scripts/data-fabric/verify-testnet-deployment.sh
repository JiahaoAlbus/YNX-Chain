#!/usr/bin/env bash
set -euo pipefail

fabric_origin="${1:?usage: verify-testnet-deployment.sh <fabric-origin> <bft-origin> <commit> <fabric-release> <operator-env> [bridge-binary]}"
bft_origin="${2:?missing BFT origin}"
commit="${3:?missing expected commit}"
fabric_release="${4:?missing Data Fabric release}"
operator_env="${5:?missing operator env}"
bridge_binary="${6:-/usr/local/bin/ynx-pay-data-fabric-bridge}"
bft_release="ynx-bft-gateway-${commit}"

[[ "$commit" =~ ^[0-9a-f]{12}$ && "$fabric_release" == "ynx-data-fabric-${commit}" ]] || {
  echo "deployment verifier identity is invalid" >&2
  exit 1
}
[[ "$fabric_origin" == https://* || "$fabric_origin" == http://127.0.0.1:* ]] || { echo "Data Fabric origin must use HTTPS or loopback HTTP" >&2; exit 1; }
[[ "$bft_origin" == https://* || "$bft_origin" == http://127.0.0.1:* ]] || { echo "BFT origin must use HTTPS or loopback HTTP" >&2; exit 1; }
[[ -r "$operator_env" && -x "$bridge_binary" ]] || { echo "operator env and bridge binary must be readable/executable" >&2; exit 1; }
for tool in curl jq; do command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 1; }; done

env_value() {
  local name="$1"
  awk -F= -v name="$name" '$1 == name { print substr($0, index($0, "=") + 1); found=1; exit } END { if (!found) exit 1 }' "$operator_env"
}
required_env() {
  local name="$1" value
  value="$(env_value "$name" 2>/dev/null || true)"
  [[ -n "$value" ]] || { echo "$name is required for deployment verification" >&2; exit 1; }
  printf '%s' "$value"
}

fabric_health="$(curl --fail --silent --show-error --max-time 10 "$fabric_origin/health")"
jq -e \
  --arg commit "$commit" --arg release "$fabric_release" \
  '.ok == true and .commit == $commit and .release == $release and
   .databaseStatus == "verified" and .brokerStatus == "verified" and
   .ledgerStatus == "verified" and .integrity == "verified" and
   .dependencyStatus.database.kind == "postgresql" and
   .dependencyStatus.broker.kind == "nats" and
   (.degradedState | type == "array" and length == 0)' \
  <<<"$fabric_health" >/dev/null || { echo "Data Fabric health does not prove PostgreSQL/NATS/Ledger integrity" >&2; exit 1; }

fabric_version="$(curl --fail --silent --show-error --max-time 10 "$fabric_origin/version")"
jq -e --arg commit "$commit" --arg release "$fabric_release" \
  '.service == "ynx-data-fabric" and .commit == $commit and .release == $release and .schemaVersion == "2.0"' \
  <<<"$fabric_version" >/dev/null || { echo "Data Fabric version identity mismatch" >&2; exit 1; }

bft_health="$(curl --fail --silent --show-error --max-time 10 "$bft_origin/health")"
jq -e --arg commit "$commit" --arg release "$bft_release" \
  '.ok == true and .service == "ynx-bft-gatewayd" and .chainId == 6423 and
   .nativeSymbol == "YNXT" and .cometChainId == "ynx_6423-1" and
   .validatorCount == 4 and .build.commit == $commit and .build.release == $release' \
  <<<"$bft_health" >/dev/null || { echo "BFT Gateway health identity mismatch" >&2; exit 1; }

bft_status="$(curl --fail --silent --show-error --max-time 10 "$bft_origin/status")"
jq -e --arg commit "$commit" --arg release "$bft_release" \
  '.chainId == 6423 and .nativeCurrencySymbol == "YNXT" and
   .truthfulStatus == "cometbft-rpc-and-abci-backed" and
   .build.commit == $commit and .build.release == $release' \
  <<<"$bft_status" >/dev/null || { echo "BFT Gateway status identity mismatch" >&2; exit 1; }

pay_events="$(curl --fail --silent --show-error --max-time 15 "$bft_origin/pay/events")"
jq -e \
  '[.events[] | select(.type == "invoice.paid" or .type == "refund.completed")] | length > 0' \
  <<<"$pay_events" >/dev/null || { echo "BFT source has no settled Pay workflow event to verify" >&2; exit 1; }

bridge_output="$(
  YNX_PAY_DATA_FABRIC_SOURCE_URL="$(required_env YNX_PAY_DATA_FABRIC_SOURCE_URL)" \
  YNX_PAY_DATA_FABRIC_SOURCE_MODE=bft \
  YNX_PAY_DATA_FABRIC_UPSTREAM_KEY_FILE= \
  YNX_PAY_DATA_FABRIC_URL="$(required_env YNX_PAY_DATA_FABRIC_URL)" \
  YNX_PAY_DATA_FABRIC_EVENT_KEY_ID="$(required_env YNX_PAY_DATA_FABRIC_EVENT_KEY_ID)" \
  YNX_PAY_DATA_FABRIC_EVENT_KEY_FILE="$(required_env YNX_PAY_DATA_FABRIC_EVENT_KEY_FILE)" \
  YNX_PAY_SOURCE_COMMIT="$commit" \
  YNX_PAY_SOURCE_RELEASE="$bft_release" \
  YNX_PAY_DATA_FABRIC_CHAIN_ID=6423 \
  "$bridge_binary" --once
)"
receipt="$(jq -cs '[.[] | select(.msg == "Pay Data Fabric integration cycle")] | last' <<<"$bridge_output")"
jq -e \
  '.canonicalEvents > 0 and .mappedSourceEvents > 0 and
   ((.committed + .alreadyCommitted) == .canonicalEvents)' \
  <<<"$receipt" >/dev/null || { echo "Bridge run did not prove canonical producer receipts" >&2; exit 1; }

ledger_verified=false
events_total=0
inbox_effects=0
journal_entries=0
for _attempt in $(seq 1 30); do
  metrics="$(curl --fail --silent --show-error --max-time 10 "$fabric_origin/metrics")"
  events_total="$(awk '$1 == "ynx_data_fabric_events" {print $2}' <<<"$metrics")"
  inbox_effects="$(awk '$1 == "ynx_data_fabric_inbox_effects" {print $2}' <<<"$metrics")"
  journal_entries="$(awk '$1 == "ynx_data_fabric_journal_entries" {print $2}' <<<"$metrics")"
  if [[ "${events_total:-}" =~ ^[0-9]+$ && "${inbox_effects:-}" =~ ^[0-9]+$ && "${journal_entries:-}" =~ ^[0-9]+$ ]] &&
    ((events_total > 0 && inbox_effects > 0 && journal_entries > 0)); then
    ledger_verified=true
    break
  fi
  sleep 1
done
[[ "$ledger_verified" == "true" ]] || { echo "Pay receipt reached the Outbox but no Ledger consumer effect was observed" >&2; exit 1; }

printf '%s\n' "$(jq -cn \
  --arg commit "$commit" --arg fabricRelease "$fabric_release" --arg bftRelease "$bft_release" \
  --argjson canonicalEvents "$(jq '.canonicalEvents' <<<"$receipt")" \
  --argjson committed "$(jq '.committed' <<<"$receipt")" \
  --argjson alreadyCommitted "$(jq '.alreadyCommitted' <<<"$receipt")" \
  --argjson events "$events_total" --argjson inboxEffects "$inbox_effects" --argjson journalEntries "$journal_entries" \
  '{status:"verified",commit:$commit,fabricRelease:$fabricRelease,bftRelease:$bftRelease,canonicalEvents:$canonicalEvents,committed:$committed,alreadyCommitted:$alreadyCommitted,events:$events,inboxEffects:$inboxEffects,journalEntries:$journalEntries}')"
