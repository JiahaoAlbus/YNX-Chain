#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

work="${YNX_GOVERNANCE_TESTNET_WORK:-$(mktemp -d)}"
network="$work/network"
manifest="$network/network-manifest.json"
governance_work="$work/governance"
base_p2p="${YNX_GOVERNANCE_TESTNET_P2P_PORT:-31656}"
base_rpc="${YNX_GOVERNANCE_TESTNET_RPC_PORT:-31757}"
base_abci="${YNX_GOVERNANCE_TESTNET_ABCI_PORT:-31858}"
governance_port="${YNX_GOVERNANCE_TESTNET_HTTP_PORT:-31941}"
declare -a homes abci_listens state_paths rpc_urls app_pids node_pids
governance_pid=""

stop_process() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -INT "$pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 50); do
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
  printf '%s\n' 'governance-testnet-drill failed; recent process logs:' >&2
  tail -80 "$work/governanced.log" 2>/dev/null >&2 || true
  for index in 0 1 2 3; do
    printf '%s\n' "--- validator $((index + 1)) CometBFT ---" >&2
    tail -25 "$work/comet-$index.log" 2>/dev/null >&2 || true
    printf '%s\n' "--- validator $((index + 1)) ABCI ---" >&2
    tail -15 "$work/abci-$index.log" 2>/dev/null >&2 || true
  done
}

cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    print_failure_logs
  fi
  stop_process "$governance_pid"
  for index in 3 2 1 0; do
    stop_process "${node_pids[$index]:-}"
    stop_process "${app_pids[$index]:-}"
  done
  if [[ "${YNX_KEEP_GOVERNANCE_TESTNET_WORK:-0}" != "1" ]]; then
    find "$work" -depth -delete 2>/dev/null || true
  else
    printf 'governance testnet work retained at %s\n' "$work"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

for offset in 0 1 2 3; do
  for port in "$((base_p2p + offset))" "$((base_rpc + offset))" "$((base_abci + offset))"; do
    if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | grep -q .; then
      echo "governance Testnet port $port is already in use" >&2
      exit 1
    fi
  done
done
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$governance_port" -sTCP:LISTEN 2>/dev/null | grep -q .; then
  echo "governance Testnet port $governance_port is already in use" >&2
  exit 1
fi

go build -o "$work/ynx-abci" ./cmd/ynx-abci
go build -o "$work/ynx-consensus-lab" ./cmd/ynx-consensus-lab
go build -o "$work/ynx-governanced" ./cmd/ynx-governanced
go build -o "$work/ynx-governance-testnet-drill" ./scripts/verify/governance-testnet-drill
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
  rpc_urls[$index]="$rpc_url"
done < <(node - "$manifest" <<'NODE'
const manifest = require(process.argv[2]);
manifest.nodes.forEach((node, index) => console.log([index, node.home, node.abciListen, node.abciStatePath, node.rpcUrl].join("\t")));
NODE
)
rpc_csv="$(IFS=,; echo "${rpc_urls[*]}")"
execution_signer="$(tr -d '\n' <"$network/fixture-signer-address")"

"$work/ynx-governance-testnet-drill" \
  -mode prepare \
  -work "$governance_work" \
  -http-address "127.0.0.1:$governance_port" \
  -rpc-urls "$rpc_csv" \
  -execution-signer "$execution_signer"

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

rpc_height() {
  local index="$1"
  curl -fsS --max-time 3 "${rpc_urls[$index]}/status" | node -e '
    let value=""; process.stdin.on("data", chunk => value += chunk);
    process.stdin.on("end", () => console.log(Number(JSON.parse(value).result.sync_info.latest_block_height)));'
}

wait_rpc() {
  local index="$1"
  for _ in $(seq 1 120); do
    if [[ "$(rpc_height "$index" 2>/dev/null || echo 0)" -ge 3 ]]; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

wait_governance() {
  for _ in $(seq 1 120); do
    curl -fsS --max-time 3 "http://127.0.0.1:$governance_port/health" >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  return 1
}

start_governance() {
  "$work/ynx-governanced" -config "$governance_work/governanced.json" >"$work/governanced.log" 2>&1 &
  governance_pid=$!
}

for index in 0 1 2 3; do start_app "$index"; done
sleep 0.5
for index in 0 1 2 3; do start_node "$index"; done
for index in 0 1 2 3; do wait_rpc "$index"; done

start_governance
wait_governance
curl -fsS "http://127.0.0.1:$governance_port/metrics" | grep -q 'ynx_governance_external_execution_enabled{.*} 1'

"$work/ynx-governance-testnet-drill" \
  -mode chain-check \
  -rpc-urls "$rpc_csv" \
  -execution-key "$network/fixture-signer.key" \
  -execution-nonce 1

if [[ "${YNX_GOVERNANCE_CHAIN_PREFLIGHT_ONLY:-0}" == "1" ]]; then
  echo "governance canonical chain preflight-only run passed"
  exit 0
fi

"$work/ynx-governance-testnet-drill" \
  -mode run \
  -work "$governance_work" \
  -rpc-urls "$rpc_csv" \
  -execution-key "$network/fixture-signer.key" \
  -execution-nonce 3 \
  -source-commit "$(git rev-parse HEAD)"

stop_process "$governance_pid"
governance_pid=""
start_governance
wait_governance
"$work/ynx-governance-testnet-drill" -mode check -work "$governance_work"

printf 'governance-testnet-drill passed: validators=4 processes=9 proposal=%s localState=restored canonicalExecution=verified\n' \
  "$(node -e 'process.stdout.write(require(process.argv[1]).proposalId)' "$governance_work/result.json")"
