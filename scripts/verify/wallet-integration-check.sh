#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

chain_id=$(ynx_jsonrpc eth_chainId | ynx_json_field '["result"]')
net_version=$(ynx_jsonrpc net_version | ynx_json_field '["result"]')
block_number=$(ynx_jsonrpc eth_blockNumber | ynx_json_field '["result"]')

[[ "$chain_id" == "0x1917" ]] || { echo "unexpected eth_chainId: $chain_id"; exit 1; }
[[ "$net_version" == "6423" ]] || { echo "unexpected net_version: $net_version"; exit 1; }
[[ "$block_number" =~ ^0x[0-9a-f]+$ ]] || { echo "invalid eth_blockNumber: $block_number"; exit 1; }

node - <<'NODE'
const fs = require("fs");
const metadata = JSON.parse(fs.readFileSync("chain-metadata/ynx-testnet.json", "utf8"));
if (metadata.chainId !== 6423) throw new Error("chain metadata chainId must be 6423");
if (metadata.nativeCurrency?.symbol !== "YNXT") throw new Error("native currency symbol must be YNXT");
const addEthereumChain = {
  chainId: "0x1917",
  chainName: "YNX Testnet",
  nativeCurrency: metadata.nativeCurrency,
  rpcUrls: metadata.rpc.length ? metadata.rpc : ["http://127.0.0.1:6420/evm"],
  blockExplorerUrls: metadata.explorers.map((explorer) => explorer.url).filter(Boolean)
};
if (addEthereumChain.nativeCurrency.decimals !== 18) throw new Error("YNXT decimals must be 18");
console.log(JSON.stringify(addEthereumChain));
NODE

echo "wallet-integration-check passed: eth_chainId=$chain_id net_version=$net_version block=$block_number native=YNXT"
