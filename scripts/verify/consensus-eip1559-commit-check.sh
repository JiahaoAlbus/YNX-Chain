#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

work="${YNX_CONSENSUS_EIP1559_WORK:-$(mktemp -d)}"
network="$work/network"
manifest="$network/network-manifest.json"
evidence_path="${YNX_CONSENSUS_EIP1559_EVIDENCE:-tmp/consensus-eip1559-commit-evidence.json}"
base_p2p="${YNX_CONSENSUS_EIP1559_P2P_PORT:-32656}"
base_rpc="${YNX_CONSENSUS_EIP1559_RPC_PORT:-32757}"
base_abci="${YNX_CONSENSUS_EIP1559_ABCI_PORT:-32858}"
gateway_port="${YNX_CONSENSUS_EIP1559_GATEWAY_PORT:-32920}"
consensus_max_gas="${YNX_CONSENSUS_EIP1559_MAX_GAS:-0}"
fixture_balance=200000
recipient="0x1111111111111111111111111111111111111111"
declare -a homes abci_listens state_paths rpc_ports app_pids node_pids
gateway_pid=""

stop_process() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -INT "$pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do
      kill -0 "$pid" >/dev/null 2>&1 || break
      sleep 0.1
    done
  fi
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -KILL "$pid" >/dev/null 2>&1 || true
  fi
  wait "$pid" >/dev/null 2>&1 || true
}

print_failure_logs() {
  printf '%s\n' 'consensus-eip1559-commit-check failed; recent process logs:' >&2
  for index in 0 1 2 3; do
    printf '%s\n' "--- validator $((index + 1)) CometBFT ---" >&2
    tail -35 "$work/comet-$index.log" 2>/dev/null >&2 || true
    printf '%s\n' "--- validator $((index + 1)) ABCI ---" >&2
    tail -25 "$work/abci-$index.log" 2>/dev/null >&2 || true
  done
  printf '%s\n' '--- BFT Gateway ---' >&2
  tail -40 "$work/gateway.log" 2>/dev/null >&2 || true
}

cleanup() {
  local status="$1"
  trap - EXIT INT TERM
  if [[ $status -ne 0 ]]; then
    print_failure_logs
  fi
  stop_process "$gateway_pid"
  for index in 3 2 1 0; do
    stop_process "${node_pids[$index]:-}"
    stop_process "${app_pids[$index]:-}"
  done
  if [[ "${YNX_KEEP_CONSENSUS_EIP1559_WORK:-0}" != "1" ]]; then
    rm -rf "$work"
  else
    printf 'consensus EIP-1559 work retained at %s\n' "$work"
  fi
  exit "$status"
}
trap 'cleanup $?' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! [[ "$consensus_max_gas" =~ ^[0-9]+$ ]]; then
  echo "YNX_CONSENSUS_EIP1559_MAX_GAS must be zero or a positive integer" >&2
  exit 1
fi

for offset in 0 1 2 3; do
  for port in "$((base_p2p + offset))" "$((base_rpc + offset))" "$((base_abci + offset))"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | grep -q .; then
      echo "consensus EIP-1559 port $port is already in use" >&2
      exit 1
    fi
  done
done
if lsof -nP -iTCP:"$gateway_port" -sTCP:LISTEN 2>/dev/null | grep -q .; then
  echo "consensus EIP-1559 gateway port $gateway_port is already in use" >&2
  exit 1
fi

mkdir -p "$(dirname "$evidence_path")"
go build -o "$work/ynx-abci" ./cmd/ynx-abci
go build -o "$work/ynx-consensus-lab" ./cmd/ynx-consensus-lab
go build -o "$work/ynx-consensus-tx" ./cmd/ynx-consensus-tx
go build -o "$work/ynx-bft-gatewayd" ./cmd/ynx-bft-gatewayd
comet_bin="$(go tool -n cometbft)"

"$work/ynx-consensus-lab" \
  -ephemeral \
  -local-fixture \
  -fixture-balance "$fixture_balance" \
  -consensus-max-gas "$consensus_max_gas" \
  -output "$network" \
  -base-p2p-port "$base_p2p" \
  -base-rpc-port "$base_rpc" \
  -base-abci-port "$base_abci" >/dev/null

while IFS=$'\t' read -r index home abci state rpc_url; do
  homes[$index]="$home"
  abci_listens[$index]="$abci"
  state_paths[$index]="$state"
  rpc_ports[$index]="${rpc_url##*:}"
done < <(node - "$manifest" <<'NODE'
const manifest = require(process.argv[2]);
manifest.nodes.forEach((node, index) => console.log([index, node.home, node.abciListen, node.abciStatePath, node.rpcUrl].join("\t")));
NODE
)

start_app() {
  local index="$1"
  "$work/ynx-abci" \
    -listen "${abci_listens[$index]}" \
    -migration-state "$network/bound-migration.json" \
    -state "${state_paths[$index]}" >"$work/abci-$index.log" 2>&1 &
  app_pids[$index]=$!
}

start_node() {
  local index="$1"
  "$comet_bin" start --home "${homes[$index]}" >"$work/comet-$index.log" 2>&1 &
  node_pids[$index]=$!
}

rpc_json() {
  local index="$1"
  local path="$2"
  curl -fsS --max-time 5 "http://127.0.0.1:${rpc_ports[$index]}$path"
}

rpc_post() {
  local index="$1"
  local payload="$2"
  curl -fsS --max-time 20 -X POST "http://127.0.0.1:${rpc_ports[$index]}" -H 'content-type: application/json' -d "$payload"
}

node_height() {
  rpc_json "$1" /status | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(Number(JSON.parse(s).result.sync_info.latest_block_height)))'
}

wait_rpc() {
  local index="$1"
  for _ in $(seq 1 100); do
    rpc_json "$index" /status >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  return 1
}

wait_height() {
  local index="$1"
  local target="$2"
  for _ in $(seq 1 160); do
    local current
    current="$(node_height "$index" 2>/dev/null || echo 0)"
    [[ "$current" -ge "$target" ]] && return 0
    sleep 0.25
  done
  return 1
}

assert_same_block() {
  local height="$1"
  shift
  local hashes=()
  for index in "$@"; do
    hashes+=("$(rpc_json "$index" "/block?height=$height" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).result.block_id.hash))')")
  done
  local first="${hashes[0]}"
  for hash in "${hashes[@]}"; do
    [[ -n "$hash" && "$hash" == "$first" ]] || { echo "block hash mismatch at height $height: ${hashes[*]}" >&2; return 1; }
  done
  printf '%s' "$first"
}

assert_same_app_hash() {
  local height="$1"
  shift
  local hashes=()
  for index in "$@"; do
    hashes+=("$(rpc_json "$index" "/block?height=$height" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).result.block.header.app_hash))')")
  done
  local first="${hashes[0]}"
  for hash in "${hashes[@]}"; do
    [[ -n "$hash" && "$hash" == "$first" ]] || { echo "AppHash mismatch at height $height: ${hashes[*]}" >&2; return 1; }
  done
  printf '%s' "$first"
}

gateway_rpc() {
  local method="$1"
  local params_json="$2"
  local payload
  payload="$(node -e 'const method=process.argv[1],params=JSON.parse(process.argv[2]);process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,method,params}))' "$method" "$params_json")"
  curl -fsS --max-time 25 -X POST "http://127.0.0.1:$gateway_port/evm" -H 'content-type: application/json' -d "$payload"
}

wait_gateway() {
  for _ in $(seq 1 100); do
    local result
    result="$(gateway_rpc eth_chainId '[]' 2>/dev/null || true)"
    if [[ -n "$result" ]] && printf '%s' "$result" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const v=JSON.parse(s);if(v.result!=="0x1917")process.exit(1)})' >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

assert_account() {
  local index="$1"
  local address="$2"
  local expected_balance="$3"
  local expected_nonce="$4"
  local payload result
  payload="$(node -e 'process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"abci_query",params:{path:"/accounts/"+process.argv[1]}}))' "$address")"
  result="$(rpc_post "$index" "$payload")"
  printf '%s' "$result" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
      const response=JSON.parse(s).result.response;
      if (Number(response.code) !== 0) throw new Error(response.log || "account query failed");
      const account=JSON.parse(Buffer.from(response.value,"base64").toString("utf8"));
      const balance=Number(process.argv[1]), nonce=Number(process.argv[2]), address=process.argv[3];
      if (account.address !== address || account.balance !== balance || account.nonce !== nonce) throw new Error(`unexpected account state: ${JSON.stringify(account)}`);
    });' "$expected_balance" "$expected_nonce" "$address"
}

for index in 0 1 2 3; do start_app "$index"; done
sleep 0.5
for index in 0 1 2 3; do start_node "$index"; done
for index in 0 1 2 3; do wait_rpc "$index"; done
for index in 0 1 2 3; do wait_height "$index" 5; done

"$work/ynx-bft-gatewayd" \
  -http "127.0.0.1:$gateway_port" \
  -comet-rpc "http://127.0.0.1:${rpc_ports[0]}" >"$work/gateway.log" 2>&1 &
gateway_pid=$!
wait_gateway

"$work/ynx-consensus-tx" \
  -key "$network/fixture-signer.key" \
  -chain-id 6423 \
  -to "$recipient" \
  -amount 125 \
  -nonce 0 \
  -envelope eip1559 \
  -format json \
  -max-priority-fee-per-gas 2 \
  -max-fee-per-gas 5 >"$work/transaction.json"
chmod 0600 "$work/transaction.json"

read -r payload_hex ethereum_hash comet_hash sender < <(node - "$work/transaction.json" <<'NODE'
const tx = require(process.argv[2]);
if (tx.schema !== "ynx-consensus-transaction/v1" || tx.envelope !== "eip1559") throw new Error("unexpected transaction evidence schema");
if (!/^0x02[0-9a-f]+$/.test(tx.payloadHex) || !/^0x[0-9a-f]{64}$/.test(tx.hash) || !/^0x[0-9a-f]{64}$/.test(tx.cometHash)) throw new Error("invalid transaction identities");
if (!/^0x[0-9a-f]{40}$/.test(tx.from) || tx.to !== "0x1111111111111111111111111111111111111111") throw new Error("invalid transaction parties");
if (tx.nonce !== 0 || tx.amount !== 125 || tx.gasLimit !== 21000 || tx.gasPrice !== 2 || tx.effectiveGasPrice !== 2 || tx.maxPriorityFeePerGas !== 2 || tx.maxFeePerGas !== 5 || tx.fee !== 42000) throw new Error("invalid bounded EIP-1559 transaction economics");
console.log([tx.payloadHex, tx.hash, tx.cometHash, tx.from].join(" "));
NODE
)

send_result="$(gateway_rpc eth_sendRawTransaction "[\"$payload_hex\"]")"
printf '%s' "$send_result" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const v=JSON.parse(s);if(v.error||v.result!==process.argv[1])throw new Error(`broadcast failed: ${s}`)})' "$ethereum_hash"

receipt_result="$(gateway_rpc eth_getTransactionReceipt "[\"$ethereum_hash\"]")"
read -r tx_height block_hash tx_index < <(printf '%s' "$receipt_result" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
  const response=JSON.parse(s); if(response.error||!response.result) throw new Error(`missing receipt: ${s}`);
  const r=response.result;
  if(r.transactionHash!==process.argv[1]||r.from!==process.argv[2]||r.to!==process.argv[3]||r.type!=="0x2"||r.status!=="0x1"||r.gasUsed!=="0x5208"||r.effectiveGasPrice!=="0x2") throw new Error(`unexpected receipt: ${JSON.stringify(r)}`);
  if(!/^0x[0-9a-f]{64}$/.test(r.blockHash)||!/^0x[0-9a-f]+$/.test(r.blockNumber)||!/^0x[0-9a-f]+$/.test(r.transactionIndex)) throw new Error("receipt block evidence is invalid");
  console.log([Number(BigInt(r.blockNumber)),r.blockHash,Number(BigInt(r.transactionIndex))].join(" "));
});' "$ethereum_hash" "$sender" "$recipient")
[[ "$tx_index" -eq 0 ]] || { echo "unexpected EIP-1559 transaction index $tx_index" >&2; exit 1; }

for index in 0 1 2 3; do wait_height "$index" "$tx_height"; done
tx_block_hash="$(assert_same_block "$tx_height" 0 1 2 3)"
tx_block_hash_lower="$(printf '%s' "$tx_block_hash" | tr '[:upper:]' '[:lower:]')"
[[ "0x$tx_block_hash_lower" == "$block_hash" ]] || { echo "gateway block hash $block_hash != Comet block hash 0x$tx_block_hash_lower" >&2; exit 1; }

state_height=$((tx_height + 1))
for index in 0 1 2 3; do wait_height "$index" "$state_height"; done
state_block_hash="$(assert_same_block "$state_height" 0 1 2 3)"
state_app_hash="$(assert_same_app_hash "$state_height" 0 1 2 3)"

for index in 0 1 2 3; do
  assert_account "$index" "$sender" 157875 1
  assert_account "$index" "$recipient" 125 0
done

sender_balance_result="$(gateway_rpc eth_getBalance "[\"$sender\",\"latest\"]")"
printf '%s' "$sender_balance_result" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const r=JSON.parse(s);if(r.error||BigInt(r.result)!==157875n)throw new Error(`unexpected sender balance: ${s}`)})'
sender_nonce_result="$(gateway_rpc eth_getTransactionCount "[\"$sender\",\"latest\"]")"
printf '%s' "$sender_nonce_result" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const r=JSON.parse(s);if(r.error||r.result!=="0x1")throw new Error(`unexpected sender nonce: ${s}`)})'
recipient_balance_result="$(gateway_rpc eth_getBalance "[\"$recipient\",\"latest\"]")"
printf '%s' "$recipient_balance_result" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const r=JSON.parse(s);if(r.error||BigInt(r.result)!==125n)throw new Error(`unexpected recipient balance: ${s}`)})'
recipient_nonce_result="$(gateway_rpc eth_getTransactionCount "[\"$recipient\",\"latest\"]")"
printf '%s' "$recipient_nonce_result" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const r=JSON.parse(s);if(r.error||r.result!=="0x0")throw new Error(`unexpected recipient nonce: ${s}`)})'

transaction_result="$(gateway_rpc eth_getTransactionByHash "[\"$ethereum_hash\"]")"
printf '%s' "$transaction_result" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
  const response=JSON.parse(s), tx=response.result;
  if(response.error||!tx||tx.hash!==process.argv[1]||tx.blockHash!==process.argv[2]||tx.from!==process.argv[3]||tx.to!==process.argv[4]) throw new Error(`unexpected transaction: ${s}`);
  if(tx.type!=="0x2"||tx.chainId!=="0x1917"||tx.gas!=="0x5208"||tx.gasPrice!=="0x2"||tx.maxPriorityFeePerGas!=="0x2"||tx.maxFeePerGas!=="0x5"||tx.value!=="0x7d"||tx.nonce!=="0x0"||!Array.isArray(tx.accessList)||tx.accessList.length!==0) throw new Error(`unexpected type-0x2 mapping: ${JSON.stringify(tx)}`);
});' "$ethereum_hash" "$block_hash" "$sender" "$recipient"

block_number_hex="$(node -e 'process.stdout.write(`0x${BigInt(process.argv[1]).toString(16)}`)' "$tx_height")"
block_result="$(gateway_rpc eth_getBlockByNumber "[\"$block_number_hex\",true]")"
printf '%s' "$block_result" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
  const response=JSON.parse(s), block=response.result;
  if(response.error||!block||block.hash!==process.argv[1]||block.number!==process.argv[2]||block.baseFeePerGas!=="0x0"||block.transactionCount!=="0x1"||block.gasUsed!=="0x5208") throw new Error(`unexpected block: ${s}`);
  if(!Array.isArray(block.transactions)||block.transactions.length!==1||block.transactions[0].hash!==process.argv[3]||block.transactions[0].type!=="0x2") throw new Error(`block transaction membership is invalid: ${JSON.stringify(block.transactions)}`);
});' "$block_hash" "$block_number_hex" "$ethereum_hash"

block_by_hash_result="$(gateway_rpc eth_getBlockByHash "[\"$block_hash\",false]")"
printf '%s' "$block_by_hash_result" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
  const response=JSON.parse(s), block=response.result;
  if(response.error||!block||block.hash!==process.argv[1]||block.number!==process.argv[2]||block.baseFeePerGas!=="0x0"||block.transactionCount!=="0x1") throw new Error(`unexpected block-by-hash result: ${s}`);
  if(!Array.isArray(block.transactions)||block.transactions.length!==1||block.transactions[0]!==process.argv[3]) throw new Error(`block-by-hash transaction membership is invalid: ${JSON.stringify(block.transactions)}`);
});' "$block_hash" "$block_number_hex" "$ethereum_hash"

count_result="$(gateway_rpc eth_getBlockTransactionCountByNumber "[\"$block_number_hex\"]")"
printf '%s' "$count_result" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const v=JSON.parse(s);if(v.error||v.result!=="0x1")throw new Error(`unexpected block transaction count: ${s}`)})'
index_result="$(gateway_rpc eth_getTransactionByBlockNumberAndIndex "[\"$block_number_hex\",\"0x0\"]")"
printf '%s' "$index_result" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const v=JSON.parse(s);if(v.error||!v.result||v.result.hash!==process.argv[1]||v.result.type!=="0x2")throw new Error(`unexpected indexed transaction: ${s}`)})' "$ethereum_hash"

direct_block="$(rpc_json 0 "/block?height=$tx_height")"
printf '%s' "$direct_block" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
  const response=JSON.parse(s), expectedPayload=Buffer.from(process.argv[1].slice(2),"hex").toString("base64"), expectedHash=process.argv[2].slice(2).toUpperCase();
  if(response.result.block_id.hash!==expectedHash && `0x${response.result.block_id.hash.toLowerCase()}`!==process.argv[3]) throw new Error("direct Comet block hash mismatch");
  const txs=response.result.block.data.txs||[];
  if(txs.length!==1||txs[0]!==expectedPayload) throw new Error(`raw transaction membership mismatch: ${JSON.stringify(txs)}`);
  if(!/^[0-9A-F]{64}$/.test(response.result.block.header.data_hash)) throw new Error("transaction block is missing data hash");
});' "$payload_hex" "$comet_hash" "$block_hash"

block_results="$(rpc_json 0 "/block_results?height=$tx_height")"
printf '%s' "$block_results" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
 const response=JSON.parse(s), results=response.result.txs_results||[];
 if(Number(response.result.height)!==Number(process.argv[1])||results.length!==1||Number(results[0].code)!==0||Number(results[0].gas_used)!==21000) throw new Error(`invalid Comet execution evidence: ${s}`);
});' "$tx_height"

fee_history_verified=false
fee_history_ratio=""
if [[ "$consensus_max_gas" -gt 0 ]]; then
  consensus_params="$(rpc_json 0 "/consensus_params?height=$tx_height")"
  printf '%s' "$consensus_params" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
  const response=JSON.parse(s), result=response.result;
  if(response.error||!result||Number(result.block_height)!==Number(process.argv[1])||Number(result.consensus_params.block.max_gas)!==Number(process.argv[2])) throw new Error(`unexpected positive max_gas evidence: ${s}`);
});' "$tx_height" "$consensus_max_gas"
  fee_history_result="$(gateway_rpc eth_feeHistory "[\"0x1\",\"$block_number_hex\",[]]")"
  fee_history_ratio="$(printf '%s' "$fee_history_result" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
  const response=JSON.parse(s), history=response.result, expected=21000/Number(process.argv[1]);
  if(response.error||!history||history.oldestBlock!==process.argv[2]||!Array.isArray(history.baseFeePerGas)||history.baseFeePerGas.length!==2||history.baseFeePerGas.some(value=>value!=="0x0")) throw new Error(`unexpected fee history base-fee evidence: ${s}`);
  if(!Array.isArray(history.gasUsedRatio)||history.gasUsedRatio.length!==1||Math.abs(Number(history.gasUsedRatio[0])-expected)>1e-12) throw new Error(`unexpected fee history gas ratio: ${s}`);
  if(!Array.isArray(history.reward)||history.reward.length!==1||!Array.isArray(history.reward[0])||history.reward[0].length!==0) throw new Error(`unexpected fee history reward evidence: ${s}`);
  console.log(history.gasUsedRatio[0]);
});' "$consensus_max_gas" "$block_number_hex")"
  fee_history_verified=true
fi

comet_tx_result="$(rpc_json 0 "/tx?hash=$comet_hash")"
printf '%s' "$comet_tx_result" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
 const response=JSON.parse(s), result=response.result;
 if(response.error||!result||result.hash!==process.argv[1].slice(2).toUpperCase()||Number(result.height)!==Number(process.argv[2])||Number(result.index)!==0||Number(result.tx_result.code)!==0||Number(result.tx_result.gas_used)!==21000) throw new Error(`invalid Comet transaction lookup evidence: ${s}`);
});' "$comet_hash" "$tx_height"

receipt_query_payload="$(node -e 'process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"abci_query",params:{path:"/evm/receipts/"+process.argv[1]}}))' "$ethereum_hash")"
receipt_query_result="$(rpc_post 0 "$receipt_query_payload")"
printf '%s' "$receipt_query_result" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
 const response=JSON.parse(s).result.response;
 if(Number(response.code)!==0) throw new Error(response.log||"receipt query failed");
 const receipt=JSON.parse(Buffer.from(response.value,"base64").toString("utf8"));
 if(receipt.transactionHash!==process.argv[1]||receipt.from!==process.argv[2]||receipt.to!==process.argv[3]||receipt.action!=="ethereum_dynamic_fee_transfer"||receipt.status!=="success"||Number(receipt.blockHeight)!==Number(process.argv[4])||!/^[0-9a-f]{64}$/.test(receipt.auditHash)) throw new Error(`invalid ABCI receipt evidence: ${JSON.stringify(receipt)}`);
});' "$ethereum_hash" "$sender" "$recipient" "$tx_height"

replay_result="$(gateway_rpc eth_sendRawTransaction "[\"$payload_hex\"]")"
printf '%s' "$replay_result" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
 const response=JSON.parse(s), text=JSON.stringify(response.error||{});
 if(!response.error||Number(response.error.code)!==-32003||!/(nonce|replay|already exists|cache|mempool)/i.test(text)) throw new Error(`replay was not rejected truthfully: ${s}`);
});'

"$work/ynx-consensus-tx" \
  -key "$network/fixture-signer.key" \
  -chain-id 1 \
  -to "$recipient" \
  -amount 1 \
  -nonce 1 \
  -envelope eip1559 \
  -format json \
  -max-priority-fee-per-gas 1 \
  -max-fee-per-gas 2 >"$work/wrong-chain.json"
wrong_chain_payload="$(node -e 'process.stdout.write(require(process.argv[1]).payloadHex)' "$work/wrong-chain.json")"
wrong_chain_result="$(gateway_rpc eth_sendRawTransaction "[\"$wrong_chain_payload\"]")"
printf '%s' "$wrong_chain_result" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
 const response=JSON.parse(s), text=JSON.stringify(response.error||{});
 if(!response.error||Number(response.error.code)!==-32003||!/(chain|transaction|invalid)/i.test(text)) throw new Error(`wrong-chain transaction was not rejected: ${s}`);
});'

source_commit="$(git rev-parse --short=12 HEAD)"
generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node - "$evidence_path" "$source_commit" "$generated_at" "$ethereum_hash" "$comet_hash" "$sender" "$recipient" "$tx_height" "$block_hash" "$state_height" "$state_block_hash" "$state_app_hash" "$consensus_max_gas" "$fee_history_verified" "$fee_history_ratio" <<'NODE'
const fs = require("fs");
const path = require("path");
const [evidencePath, sourceCommit, generatedAt, ethereumHash, cometHash, sender, recipient, txHeight, blockHash, stateHeight, stateBlockHash, stateAppHash, consensusMaxGas, feeHistoryVerified, feeHistoryRatio] = process.argv.slice(2);
const report = {
  schema: "ynx-consensus-eip1559-commit-evidence/v1",
  generatedAt,
  sourceCommit,
  mode: "local-ephemeral-four-validator",
  deployedPublic: false,
  productionSigned: false,
  profile: {
    chainId: 6423,
    transactionType: "0x2",
    baseFeePerGas: 0,
    maxPriorityFeePerGas: 2,
    maxFeePerGas: 5,
    effectiveGasPrice: 2,
    gasLimit: 21000,
    accessList: "empty"
  },
  transaction: {
    ethereumHash,
    cometHash,
    sender,
    recipient,
    value: 125,
    effectiveFee: 42000,
    maximumFeeExposure: 105000,
    blockHeight: Number(txHeight),
    blockHash,
    transactionIndex: 0
  },
  consensus: {
    validatorCount: 4,
    allValidatorBlockHashEqual: true,
    allValidatorAccountStateEqual: true,
    stateHeight: Number(stateHeight),
    stateBlockHash,
    appHash: stateAppHash,
    maxGas: Number(consensusMaxGas),
    senderBalance: 157875,
    senderNonce: 1,
    recipientBalance: 125,
    recipientNonce: 0
  },
  evidence: {
    gatewayBroadcastCommitted: true,
    rawTransactionInCometBlock: true,
    cometTransactionLookupValidated: true,
    cometExecutionGasUsed: 21000,
    auditedABCIReceiptValidatedByGateway: true,
    transactionByHashValidated: true,
    blockByNumberValidated: true,
    blockByHashValidated: true,
    blockTransactionIndexValidated: true,
    gatewayAccountBalanceAndNonceValidated: true,
    committedFeeHistoryValidated: feeHistoryVerified === "true",
    feeHistoryGasUsedRatio: feeHistoryRatio === "" ? null : Number(feeHistoryRatio),
    replayRejected: true,
    wrongChainRejected: true
  }
};
fs.mkdirSync(path.dirname(evidencePath), {recursive: true});
fs.writeFileSync(evidencePath, JSON.stringify(report, null, 2) + "\n", {mode: 0o600});
NODE

printf 'consensus-eip1559-commit-check passed: ethereumHash=%s cometHash=%s blockHeight=%s stateHeight=%s appHash=%s evidence=%s\n' \
  "$ethereum_hash" "$comet_hash" "$tx_height" "$state_height" "$state_app_hash" "$evidence_path"
