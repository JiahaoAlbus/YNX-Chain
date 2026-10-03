#!/usr/bin/env bash
set -euo pipefail

# Injects artifacts produced by the real YNX Wallet and verifies that the product
# returns matching central Pay API evidence. It never constructs or signs an intent.
required=(YNX_PAY_PRODUCT_URL YNX_PAY_WALLET_SESSION YNX_PAY_INVOICE_ID YNX_PAY_SIGNED_INTENT_FILE YNX_PAY_WALLET_RESULT_FILE)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing $name; real Wallet/Testnet evidence is required" >&2
    exit 2
  fi
done
command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
[[ -r "$YNX_PAY_SIGNED_INTENT_FILE" ]] || { echo "signed intent file is unreadable" >&2; exit 2; }
[[ -r "$YNX_PAY_WALLET_RESULT_FILE" ]] || { echo "wallet result file is unreadable" >&2; exit 2; }

intent_invoice=$(jq -er '.invoiceId' "$YNX_PAY_SIGNED_INTENT_FILE")
intent_tx=$(jq -er '.transactionHash' "$YNX_PAY_WALLET_RESULT_FILE")
[[ "$intent_invoice" == "$YNX_PAY_INVOICE_ID" ]] || { echo "invoice does not match signed intent" >&2; exit 3; }
[[ "$intent_tx" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "wallet result transaction hash is not canonical" >&2; exit 3; }

body=$(jq -cn \
  --slurpfile intent "$YNX_PAY_SIGNED_INTENT_FILE" \
  --slurpfile result "$YNX_PAY_WALLET_RESULT_FILE" \
  --arg key "proof-${intent_tx#0x}" \
  '{intent:$intent[0],result:$result[0],idempotencyKey:$key}')
response=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $YNX_PAY_WALLET_SESSION" \
  -H 'Content-Type: application/json' \
  --data "$body" \
  "${YNX_PAY_PRODUCT_URL%/}/v1/invoices/$YNX_PAY_INVOICE_ID/settlements")

jq -e --arg tx "${intent_tx,,}" '
  .status == "committed" and
  .settlement.status == "committed" and
  (.settlement.transactionHash | ascii_downcase) == $tx and
  .settlement.blockNumber > 0 and
  (.settlement.auditHash | length) > 0 and
  .settlement.source == "authoritative-central-pay-api"
' <<<"$response" >/dev/null

lookup=$(curl --fail-with-body --silent --show-error \
  "${YNX_PAY_PRODUCT_URL%/}/v1/invoices/$YNX_PAY_INVOICE_ID")
jq -e --arg tx "${intent_tx,,}" '
  .status == "committed" and
  (.settlement.transactionHash | ascii_downcase) == $tx and
  .settlement.blockNumber > 0
' <<<"$lookup" >/dev/null

jq '{invoiceId:.id,status,transactionHash:.settlement.transactionHash,blockNumber:.settlement.blockNumber,auditHash:.settlement.auditHash,source:.settlement.source,committedAt:.settlement.committedAt}' <<<"$lookup"
