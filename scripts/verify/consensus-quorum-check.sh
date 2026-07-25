#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

work="${YNX_CONSENSUS_QUORUM_WORK:-$(mktemp -d)}"
network="$work/network"
manifest="$network/network-manifest.json"
evidence_path="${YNX_CONSENSUS_QUORUM_EVIDENCE:-tmp/consensus-quorum-evidence.json}"
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

file_sha256() {
  node -e 'const fs=require("fs"),crypto=require("crypto");const h=crypto.createHash("sha256");const s=fs.createReadStream(process.argv[1]);s.on("data",d=>h.update(d));s.on("end",()=>process.stdout.write(h.digest("hex")));s.on("error",e=>{console.error(e);process.exit(1)});' "$1"
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
initial_app_hash="$(assert_same_app_hash "$initial_height" 0 1 2 3)"
assert_commit_signatures 0 "$initial_height" 3

node - "$manifest" "$base_rpc" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const manifest = require(process.argv[2]);
const baseRPC = Number(process.argv[3]);
const genesisPayloads = manifest.nodes.map(node => fs.readFileSync(`${node.home}/config/genesis.json`, "utf8"));
for (const payload of genesisPayloads) {
  if (payload !== genesisPayloads[0]) throw new Error("validator genesis files differ");
}
const genesis = JSON.parse(genesisPayloads[0]);
if (genesis.chain_id !== manifest.chainId) throw new Error(`genesis chain ID ${genesis.chain_id} != ${manifest.chainId}`);
const genesisHash = crypto.createHash("sha256").update(genesisPayloads[0]).digest("hex");
if (genesisHash !== manifest.genesisHash) throw new Error(`genesis hash ${genesisHash} != ${manifest.genesisHash}`);
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

backup_height="$(node_height 3)"
stop_process "${node_pids[3]}"; node_pids[3]=""
stop_process "${app_pids[3]}"; app_pids[3]=""
backup_archive="$work/validator-4-height-${backup_height}.tar.gz"
backup_partial="$backup_archive.partial"
tar -czf "$backup_partial" -C "$network" validator-4
tar -tzf "$backup_partial" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const entries=s.split(/\r?\n/).filter(Boolean);
    if (!entries.length) throw new Error("validator backup archive is empty");
    for (const entry of entries) {
      const normalized=entry.endsWith("/") ? entry.slice(0,-1) : entry;
      const parts=normalized.split("/");
      if (parts[0] !== "validator-4" || parts.some(part => part === "" || part === "." || part === "..") || entry.startsWith("/")) {
        throw new Error(`unsafe validator backup entry: ${entry}`);
      }
    }
    for (const required of ["validator-4/config/genesis.json","validator-4/config/priv_validator_key.json","validator-4/data/priv_validator_state.json","validator-4/data/ynx-abci-state.json"]) {
      if (!entries.includes(required)) throw new Error(`validator backup missing ${required}`);
    }
  });'
mv "$backup_partial" "$backup_archive"
chmod 0600 "$backup_archive"
backup_sha256="$(file_sha256 "$backup_archive")"
backup_bytes="$(wc -c <"$backup_archive" | tr -d ' ')"
[[ "$backup_sha256" =~ ^[0-9a-f]{64}$ && "$backup_bytes" -gt 0 ]] || { echo "validator backup evidence is invalid" >&2; exit 1; }
start_app 3
sleep 0.5
start_node 3
wait_rpc 3
backup_rejoin_target="$(node_height 0)"
wait_height 3 "$backup_rejoin_target"
for index in 0 1 2; do wait_height "$index" "$backup_rejoin_target"; done
backup_rejoin_hash="$(assert_same_block "$backup_rejoin_target" 0 1 2 3)"
backup_rejoin_app_hash="$(assert_same_app_hash "$backup_rejoin_target" 0 1 2 3)"

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
tx_state_height=$((tx_height + 1))
for index in 0 1 2 3; do wait_height "$index" "$tx_state_height"; done
tx_app_hash="$(assert_same_app_hash "$tx_state_height" 0 1 2 3)"

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
      const balance=Number(process.argv[1]), nonce=Number(process.argv[2]);
      if (account.balance !== balance || account.nonce !== nonce) throw new Error(`unexpected account state: ${JSON.stringify(account)}`);
    });' "$expected_balance" "$expected_nonce"
}
for index in 0 1 2 3; do
  assert_account "$index" "$fixture_signer" 874 1
  assert_account "$index" "$fixture_recipient" 125 0
done

before_stop="$(node_height 0)"
stop_process "${node_pids[3]}"; node_pids[3]=""
stop_process "${app_pids[3]}"; app_pids[3]=""
three_validator_height=$((before_stop + 4))
for index in 0 1 2; do wait_height "$index" "$three_validator_height"; done
three_validator_hash="$(assert_same_block "$three_validator_height" 0 1 2)"
three_validator_app_hash="$(assert_same_app_hash "$three_validator_height" 0 1 2)"
assert_commit_signatures 0 "$three_validator_height" 3

[[ "$(file_sha256 "$backup_archive")" == "$backup_sha256" ]] || { echo "validator backup checksum changed before restore" >&2; exit 1; }
tampered_backup="$work/validator-4-tampered.tar.gz"
cp "$backup_archive" "$tampered_backup"
printf 'tamper' >>"$tampered_backup"
[[ "$(file_sha256 "$tampered_backup")" != "$backup_sha256" ]] || { echo "tampered validator backup was not detected" >&2; exit 1; }
rm -f "$tampered_backup"
rm -rf "${homes[3]}"
tar -xzf "$backup_archive" -C "$network"
for required in "${homes[3]}/config/genesis.json" "${homes[3]}/config/priv_validator_key.json" "${homes[3]}/data/priv_validator_state.json" "${state_paths[3]}"; do
  [[ -s "$required" ]] || { echo "restored validator backup missing $required" >&2; exit 1; }
done
restored_state_height="$(node -e 'const s=require(process.argv[1]); if (!s.initialized || !s.appHash) process.exit(1); process.stdout.write(String(s.height));' "${state_paths[3]}")"
[[ "$restored_state_height" -le "$backup_height" ]] || { echo "restored ABCI state height $restored_state_height exceeds backup height $backup_height" >&2; exit 1; }

start_app 3
sleep 0.5
start_node 3
wait_rpc 3
recovery_target="$(node_height 0)"
wait_height 3 "$recovery_target"
for index in 0 1 2; do wait_height "$index" "$recovery_target"; done
recovery_hash="$(assert_same_block "$recovery_target" 0 1 2 3)"
recovery_app_hash="$(assert_same_app_hash "$recovery_target" 0 1 2 3)"
for index in 0 1 2 3; do
  assert_account "$index" "$fixture_signer" 874 1
  assert_account "$index" "$fixture_recipient" 125 0
done

replay_result="$(rpc_post 3 "$broadcast_payload")"
replay_rejection="$(printf '%s' "$replay_result" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const data=JSON.parse(s);
    const failure=data.error ?? {
      checkCode:Number(data.result?.check_tx?.code ?? 0),
      checkLog:data.result?.check_tx?.log ?? "",
      deliverCode:Number(data.result?.tx_result?.code ?? 0),
      deliverLog:data.result?.tx_result?.log ?? ""
    };
    const text=JSON.stringify(failure);
    const rejected=Boolean(data.error) || failure.checkCode !== 0 || failure.deliverCode !== 0;
    if (!rejected) throw new Error(`replayed transaction was accepted: ${s}`);
    if (!/(nonce|replay|already exists|cache|mempool)/i.test(text)) throw new Error(`replay rejection was not attributable to replay protection: ${text}`);
    console.log("nonce-or-mempool-replay-rejected");
  });')"

for index in 0 1 2 3; do
  state_height="$(node -e 'const s=require(process.argv[1]); if (!s.initialized || !s.appHash || s.height < 2) process.exit(1); console.log(s.height)' "${state_paths[$index]}")"
  [[ "$state_height" -ge 2 ]] || exit 1
done

source_commit="$(git rev-parse --short=12 HEAD)"
generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node - "$evidence_path" "$manifest" "$source_commit" "$generated_at" "$initial_height" "$initial_hash" "$initial_app_hash" "$tx_height" "$tx_hash" "$tx_block_hash" "$tx_state_height" "$tx_app_hash" "$three_validator_height" "$three_validator_hash" "$three_validator_app_hash" "$recovery_target" "$recovery_hash" "$recovery_app_hash" "$replay_rejection" "$backup_height" "$backup_sha256" "$backup_bytes" "$backup_rejoin_target" "$backup_rejoin_hash" "$backup_rejoin_app_hash" "$restored_state_height" <<'NODE'
const fs = require("fs");
const path = require("path");
const [
  evidencePath, manifestPath, sourceCommit, generatedAt,
  initialHeight, initialBlockHash, initialAppHash,
  txHeight, txHash, txBlockHash, txAppHashHeight, txAppHash,
  threeValidatorHeight, threeValidatorBlockHash, threeValidatorAppHash,
  recoveryHeight, recoveryBlockHash, recoveryAppHash, replayClass,
  backupHeight, backupSha256, backupBytes, backupRejoinHeight, backupRejoinBlockHash, backupRejoinAppHash, restoredStateHeight
] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const report = {
  schema: "ynx-consensus-quorum-evidence/v1",
  generatedAt,
  sourceCommit,
  mode: "local-ephemeral-four-validator",
  deployedPublic: false,
  productionSigned: false,
  network: {
    chainId: manifest.chainId,
    validatorCount: manifest.nodes.length,
    genesisHash: manifest.genesisHash,
    committedStateVersion: 11
  },
  evidence: {
    identicalGenesis: true,
    initial: { height: Number(initialHeight), blockHash: initialBlockHash, appHash: initialAppHash, minimumPrecommits: 3 },
    backupRestoreRollback: {
      backupHeight: Number(backupHeight),
      backupSha256,
      backupBytes: Number(backupBytes),
      archiveValidated: true,
      tamperDetected: true,
      rejoinedBeforeTransaction: { height: Number(backupRejoinHeight), blockHash: backupRejoinBlockHash, appHash: backupRejoinAppHash },
      restoredStateHeight: Number(restoredStateHeight),
      rolledBackBelowCurrentHeight: Number(restoredStateHeight) < Number(threeValidatorHeight),
      replayedToCurrentState: true
    },
    transaction: { height: Number(txHeight), txHash, blockHash: txBlockHash, appHashHeight: Number(txAppHashHeight), appHash: txAppHash, allNodeAccountQueriesEqual: true },
    oneValidatorStopped: { height: Number(threeValidatorHeight), blockHash: threeValidatorBlockHash, appHash: threeValidatorAppHash, minimumPrecommits: 3 },
    validatorRecovered: { height: Number(recoveryHeight), blockHash: recoveryBlockHash, appHash: recoveryAppHash, allNodeAccountQueriesEqual: true },
    replayRejected: true,
    replayClass
  }
};
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
NODE

printf 'consensus-quorum-check passed: initialHeight=%s initialHash=%s txHeight=%s txHash=%s txBlockHash=%s threeValidatorHeight=%s threeValidatorHash=%s recoveryHeight=%s recoveryHash=%s validators=4\n' \
  "$initial_height" "$initial_hash" "$tx_height" "$tx_hash" "$tx_block_hash" "$three_validator_height" "$three_validator_hash" "$recovery_target" "$recovery_hash"
printf 'consensus state evidence: initialAppHash=%s txAppHashHeight=%s txAppHash=%s threeValidatorAppHash=%s recoveryAppHash=%s replay=%s\n' \
  "$initial_app_hash" "$tx_state_height" "$tx_app_hash" "$three_validator_app_hash" "$recovery_app_hash" "$replay_rejection"
printf 'consensus recovery evidence: backupHeight=%s backupSha256=%s backupBytes=%s restoredStateHeight=%s recoveryHeight=%s rollbackReplay=true\n' \
  "$backup_height" "$backup_sha256" "$backup_bytes" "$restored_state_height" "$recovery_target"
