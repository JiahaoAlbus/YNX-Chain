#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh

export YNX_VERIFY_WORK="${YNX_VERIFY_WORK:-$(mktemp -d)}"
export YNX_KEEP_VERIFY_WORK=1
ynx_start_local_testnet
cleanup() {
  ynx_stop_local_testnet
  rm -rf "$YNX_VERIFY_WORK"
}
trap cleanup EXIT

curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_consensus_export_owner","amount":10000}' >/dev/null
curl -fsS -X POST "$YNX_REST_URL/transfer" -H 'content-type: application/json' -d '{"from":"ynx_consensus_export_owner","to":"ynx_consensus_export_receiver","amount":250}' >/dev/null
sleep 3
ynx_stop_local_testnet
export YNX_STARTED_PID=""

output="$YNX_VERIFY_WORK/consensus/ynx-consensus-state.json"
go run ./cmd/ynx-chaind -network testnet -data-dir "$YNX_VERIFY_WORK/state" -block-production=true -replication-key='' -export-consensus-state "$output" >/dev/null

node - "$output" <<'NODE'
const fs = require("fs");
const crypto = require("crypto");
const path = process.argv[2];
const state = JSON.parse(fs.readFileSync(path, "utf8"));
if (state.version !== 1 || state.sourceFormat !== "ynx-devnet-state-v1") throw new Error("unexpected migration schema");
if (state.network.chainId !== 6423 || state.network.nativeCurrencySymbol !== "YNXT") throw new Error("unexpected migration network identity");
if (!Number.isInteger(state.height) || state.height < 1 || !state.lastBlockHash) throw new Error("missing committed migration point");
if (!Array.isArray(state.accounts) || !state.accounts.some(account => account.address === "ynx_consensus_export_receiver" && account.balance === 250)) throw new Error("migrated receiver balance missing");
if (!Array.isArray(state.validators) || state.validators.length < 1) throw new Error("migrated validator set missing");
const expected = state.stateHash;
state.stateHash = "";
const actual = crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
if (actual !== expected) throw new Error(`state hash mismatch: ${actual} != ${expected}`);
console.log(`consensus-migration-check passed: height=${state.height} accounts=${state.accounts.length} validators=${state.validators.length} stateHash=${expected}`);
NODE
