#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export YNX_CONSENSUS_EIP1559_MAX_GAS=42000
export YNX_CONSENSUS_EIP1559_P2P_PORT="${YNX_CONSENSUS_FEE_HISTORY_P2P_PORT:-36656}"
export YNX_CONSENSUS_EIP1559_RPC_PORT="${YNX_CONSENSUS_FEE_HISTORY_RPC_PORT:-36757}"
export YNX_CONSENSUS_EIP1559_ABCI_PORT="${YNX_CONSENSUS_FEE_HISTORY_ABCI_PORT:-36858}"
export YNX_CONSENSUS_EIP1559_GATEWAY_PORT="${YNX_CONSENSUS_FEE_HISTORY_GATEWAY_PORT:-36920}"
export YNX_CONSENSUS_EIP1559_EVIDENCE="${YNX_CONSENSUS_FEE_HISTORY_EVIDENCE:-tmp/consensus-fee-history-evidence.json}"

bash ./scripts/verify/consensus-eip1559-commit-check.sh

node - "$YNX_CONSENSUS_EIP1559_EVIDENCE" <<'NODE'
const fs = require("fs");
const evidence = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (evidence.schema !== "ynx-consensus-eip1559-commit-evidence/v1") throw new Error("unexpected fee-history evidence schema");
if (evidence.mode !== "local-ephemeral-four-validator" || evidence.deployedPublic !== false || evidence.productionSigned !== false) throw new Error("fee-history evidence release truthfulness drift");
if (evidence.consensus.validatorCount !== 4 || evidence.consensus.maxGas !== 42000 || evidence.consensus.allValidatorBlockHashEqual !== true || evidence.consensus.allValidatorAccountStateEqual !== true) throw new Error("four-validator fee-history consensus evidence is incomplete");
if (evidence.evidence.cometExecutionGasUsed !== 21000 || evidence.evidence.committedFeeHistoryValidated !== true || Math.abs(evidence.evidence.feeHistoryGasUsedRatio - 0.5) > 1e-12) throw new Error("committed fee-history gas evidence mismatch");
if (evidence.profile.baseFeePerGas !== 0 || evidence.profile.transactionType !== "0x2") throw new Error("fee-history zero-base-fee profile drift");
NODE

echo "consensus-fee-history-check passed: four validators committed a bounded type-0x02 transfer under max_gas=42000, eth_feeHistory returned zero base fees and gasUsedRatio=0.5 from exact committed block_results/consensus_params evidence, and public/production flags remain false"
