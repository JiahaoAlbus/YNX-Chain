#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

YNX_REST_URL="${YNX_REST_URL:-https://rpc.ynxweb4.com}"
YNX_EVM_URL="${YNX_EVM_URL:-https://evm.ynxweb4.com}"
export YNX_REST_URL YNX_EVM_URL

node --input-type=module <<'NODE'
import {YNXClient, assertYNXTestnetSnapshot} from "./sdk/js/index.js";

const snapshot = assertYNXTestnetSnapshot(await new YNXClient({
  restUrl: process.env.YNX_REST_URL,
  evmUrl: process.env.YNX_EVM_URL,
}).getChainSnapshot());
if (snapshot.status.height < 1 || snapshot.evmBlockNumber < 1) throw new Error("live public height must be positive");
if (!snapshot.status.build?.release || !snapshot.status.build?.commit) throw new Error("live public release identity is missing");
console.log(`JavaScript SDK remote proof: chain=${snapshot.evmChainId} restHeight=${snapshot.status.height} evmHeight=${snapshot.evmBlockNumber} release=${snapshot.status.build?.release || "unknown"}`);
NODE

PYTHONPATH=sdk/python python3 <<'PY'
import os
from ynx_client import YNXClient, assert_ynx_testnet_snapshot

snapshot = assert_ynx_testnet_snapshot(YNXClient(
    rest_url=os.environ["YNX_REST_URL"],
    evm_url=os.environ["YNX_EVM_URL"],
).get_chain_snapshot())
assert snapshot["status"]["height"] > 0 and snapshot["evmBlockNumber"] > 0, "live public height must be positive"
assert snapshot["status"].get("build", {}).get("release") and snapshot["status"].get("build", {}).get("commit"), "live public release identity is missing"
print(
    "Python SDK remote proof: "
    f"chain={snapshot['evmChainId']} restHeight={snapshot['status']['height']} "
    f"evmHeight={snapshot['evmBlockNumber']} release={snapshot['status'].get('build', {}).get('release', 'unknown')}"
)
PY

echo "sdk-remote-check passed: both SDKs verified the live public YNX Testnet without mutation"
