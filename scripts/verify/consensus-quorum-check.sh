#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

work="${YNX_CONSENSUS_QUORUM_WORK:-$(mktemp -d)}"
network="$work/network"
manifest="$network/network-manifest.json"
base_p2p="${YNX_CONSENSUS_QUORUM_P2P_PORT:-28656}"
base_rpc="${YNX_CONSENSUS_QUORUM_RPC_PORT:-28757}"
base_abci="${YNX_CONSENSUS_QUORUM_ABCI_PORT:-28858}"
declare -a homes abci_listens state_paths rpc_ports app_pids node_pids

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
  printf '%s\n' 'consensus-quorum-check failed; recent process logs:' >&2
  for index in 0 1 2 3; do
    printf '%s\n' "--- validator $((index + 1)) CometBFT ---" >&2
    tail -35 "$work/comet-$index.log" 2>/dev/null >&2 || true
    printf '%s\n' "--- validator $((index + 1)) ABCI ---" >&2
    tail -20 "$work/abci-$index.log" 2>/dev/null >&2 || true
  done
}

cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    print_failure_logs
  fi
  for index in 3 2 1 0; do
    stop_process "${node_pids[$index]:-}"
    stop_process "${app_pids[$index]:-}"
  done
  if [[ "${YNX_KEEP_CONSENSUS_QUORUM_WORK:-0}" != "1" ]]; then
    rm -rf "$work"
  else
    printf 'consensus quorum work retained at %s\n' "$work"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

for offset in 0 1 2 3; do
  for port in "$((base_p2p + offset))" "$((base_rpc + offset))" "$((base_abci + offset))"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | grep -q .; then
      echo "consensus quorum port $port is already in use" >&2
      exit 1
    fi
  done
done

go build -o "$work/ynx-abci" ./cmd/ynx-abci
go build -o "$work/ynx-consensus-lab" ./cmd/ynx-consensus-lab
go build -o "$work/ynx-consensus-tx" ./cmd/ynx-consensus-tx
comet_bin="$(go tool -n cometbft)"

"$work/ynx-consensus-lab" \
  -ephemeral \
  -local-fixture \
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
  curl -fsS --max-time 3 "http://127.0.0.1:${rpc_ports[$index]}$path"
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
  for _ in $(seq 1 120); do
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

assert_commit_signatures() {
  local index="$1"
  local height="$2"
  local expected_min="$3"
  rpc_json "$index" "/commit?height=$height" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
      const data=JSON.parse(s).result.signed_header.commit.signatures || [];
      const committed=data.filter(signature => Number(signature.block_id_flag) === 2).length;
      const minimum=Number(process.argv[1]);
      if (committed < minimum) throw new Error(`commit has ${committed} signatures, expected at least ${minimum}`);
    });' "$expected_min"
}

for index in 0 1 2 3; do start_app "$index"; done
sleep 0.5
for index in 0 1 2 3; do start_node "$index"; done
for index in 0 1 2 3; do wait_rpc "$index"; done
for index in 0 1 2 3; do wait_height "$index" 6; done

initial_height=6
initial_hash="$(assert_same_block "$initial_height" 0 1 2 3)"
assert_commit_signatures 0 "$initial_height" 3

node - "$manifest" "$base_rpc" <<'NODE'
const fs = require("fs");
const manifest = require(process.argv[2]);
const baseRPC = Number(process.argv[3]);
const expected = [...manifest.nodes.map(node => node.consensusAddress)].sort();
const validatorRequests = manifest.nodes.map((_, index) => fetch(`http://127.0.0.1:${baseRPC + index}/validators?height=6`).then(response => response.json()));
const commitRequests = [2, 3, 4, 5, 6].map(height => fetch(`http://127.0.0.1:${baseRPC}/commit?height=${height}`).then(response => response.json()));
Promise.all([Promise.all(validatorRequests), Promise.all(commitRequests)]).then(([results, commits]) => {
  for (const result of results) {
    const actual = result.result.validators.map(validator => validator.address).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`validator set mismatch: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
  const observedSigners = new Set();
  for (const commit of commits) {
    for (const signature of commit.result.signed_header.commit.signatures || []) {
      if (Number(signature.block_id_flag) === 2 && signature.validator_address) observedSigners.add(signature.validator_address);
    }
  }
  for (const address of expected) {
    if (!observedSigners.has(address)) throw new Error(`validator ${address} did not sign any observed quorum commit`);
  }
  const raw = fs.readFileSync(process.argv[2], "utf8");
  if (raw.includes("priv_key") || raw.includes("privateKey")) throw new Error("manifest exposes private key material");
}).catch(error => { console.error(error); process.exit(1); });
NODE

for index in 0 1 2 3; do
  peers="$(rpc_json "$index" /net_info | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(Number(JSON.parse(s).result.n_peers)))')"
  [[ "$peers" -ge 3 ]] || { echo "validator $index has only $peers peers" >&2; exit 1; }
done

fixture_signer="$(tr -d '\n' <"$network/fixture-signer-address")"
fixture_recipient="0x1111111111111111111111111111111111111111"
signed_tx_base64="$("$work/ynx-consensus-tx" -key "$network/fixture-signer.key" -chain-id 6423 -to "$fixture_recipient" -amount 125 -nonce 1 | base64 | tr -d '\n')"
broadcast_payload="$(node -e 'process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"broadcast_tx_commit",params:{tx:process.argv[1]}}))' "$signed_tx_base64")"
broadcast_result="$(rpc_post 0 "$broadcast_payload")"
tx_height="$(printf '%s' "$broadcast_result" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const data=JSON.parse(s); if (data.error) throw new Error(JSON.stringify(data.error));
    if (Number(data.result.check_tx.code) !== 0 || Number(data.result.tx_result.code) !== 0) throw new Error(`signed transaction failed: ${s}`);
    console.log(Number(data.result.height));
  });')"
tx_hash="$(printf '%s' "$broadcast_result" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).result.hash))')"
for index in 0 1 2 3; do wait_height "$index" "$tx_height"; done
tx_block_hash="$(assert_same_block "$tx_height" 0 1 2 3)"

assert_account() {
  local address="$1"
  local expected_balance="$2"
  local expected_nonce="$3"
  local payload result
  payload="$(node -e 'process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"abci_query",params:{path:"/accounts/"+process.argv[1]}}))' "$address")"
  result="$(rpc_post 0 "$payload")"
  printf '%s' "$result" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
      const response=JSON.parse(s).result.response;
      if (Number(response.code) !== 0) throw new Error(response.log || "account query failed");
      const account=JSON.parse(Buffer.from(response.value,"base64").toString("utf8"));
      const balance=Number(process.argv[1]), nonce=Number(process.argv[2]);
      if (account.balance !== balance || account.nonce !== nonce) throw new Error(`unexpected account state: ${JSON.stringify(account)}`);
    });' "$expected_balance" "$expected_nonce"
}
assert_account "$fixture_signer" 874 1
assert_account "$fixture_recipient" 125 0

before_stop="$(node_height 0)"
stop_process "${node_pids[3]}"; node_pids[3]=""
stop_process "${app_pids[3]}"; app_pids[3]=""
three_validator_height=$((before_stop + 4))
for index in 0 1 2; do wait_height "$index" "$three_validator_height"; done
three_validator_hash="$(assert_same_block "$three_validator_height" 0 1 2)"
assert_commit_signatures 0 "$three_validator_height" 3

start_app 3
sleep 0.5
start_node 3
wait_rpc 3
recovery_target="$(node_height 0)"
wait_height 3 "$recovery_target"
for index in 0 1 2; do wait_height "$index" "$recovery_target"; done
recovery_hash="$(assert_same_block "$recovery_target" 0 1 2 3)"

for index in 0 1 2 3; do
  state_height="$(node -e 'const s=require(process.argv[1]); if (!s.initialized || !s.appHash || s.height < 2) process.exit(1); console.log(s.height)' "${state_paths[$index]}")"
  [[ "$state_height" -ge 2 ]] || exit 1
done

printf 'consensus-quorum-check passed: initialHeight=%s initialHash=%s txHeight=%s txHash=%s txBlockHash=%s threeValidatorHeight=%s threeValidatorHash=%s recoveryHeight=%s recoveryHash=%s validators=4\n' \
  "$initial_height" "$initial_hash" "$tx_height" "$tx_hash" "$tx_block_hash" "$three_validator_height" "$three_validator_hash" "$recovery_target" "$recovery_hash"
