#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

developer="ynx_developer_quickstart"
curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d "{\"address\":\"$developer\",\"amount\":1000}" >/dev/null

source='pragma solidity ^0.8.24; contract Quickstart { function ping() public pure returns (uint256) { return 1; } }'
compile_payload=$(node -e 'const source=process.argv[1]; process.stdout.write(JSON.stringify({name:"Quickstart",source}))' "$source")
compile=$(printf '%s' "$compile_payload" | curl -fsS -X POST "$YNX_REST_URL/ide/compile" -H 'content-type: application/json' -d @-)
[[ "$(printf '%s' "$compile" | ynx_json_field '["ok"]')" == "true" ]] || { echo "compile preflight failed"; exit 1; }

deploy_payload=$(node -e 'const source=process.argv[1]; process.stdout.write(JSON.stringify({deployer:"ynx_developer_quickstart",name:"Quickstart",source}))' "$source")
deploy=$(printf '%s' "$deploy_payload" | curl -fsS -X POST "$YNX_REST_URL/ide/deploy" -H 'content-type: application/json' -d @-)
contract_address=$(printf '%s' "$deploy" | ynx_json_field '["contract"]["address"]')
verify_payload=$(node -e 'const address=process.argv[1], source=process.argv[2]; process.stdout.write(JSON.stringify({address,source}))' "$contract_address" "$source")
verified=$(printf '%s' "$verify_payload" | curl -fsS -X POST "$YNX_REST_URL/ide/verify" -H 'content-type: application/json' -d @-)
[[ "$(printf '%s' "$verified" | ynx_json_field '["verified"]')" == "true" ]] || { echo "contract verification failed"; exit 1; }

curl -fsS "$YNX_REST_URL/trust/trace/$developer" >/dev/null
curl -fsS "$YNX_REST_URL/resource-market/quote?address=$developer&bandwidth=10&compute=1&aiCredits=1&trustCredits=1" >/dev/null
curl -fsS -X POST "$YNX_REST_URL/pay/intents" -H 'content-type: application/json' -d '{"merchant":"developer_quickstart","amount":1}' >/dev/null

node --input-type=module - <<'NODE'
import {ynxTestnet} from "./sdk/js/index.js";
if (ynxTestnet.chainId !== "0x1917") throw new Error("SDK chainId mismatch");
if (ynxTestnet.nativeCurrency.symbol !== "YNXT") throw new Error("SDK native symbol mismatch");
console.log("js sdk metadata ok");
NODE

python3 - <<'PY'
from pathlib import Path
source = Path("sdk/python/ynx_client.py").read_text()
assert "def get_status" in source
print("python sdk source ok")
PY

echo "developer-quickstart-check passed: contract=$contract_address"
