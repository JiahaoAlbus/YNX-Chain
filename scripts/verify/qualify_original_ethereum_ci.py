#!/usr/bin/env python3
"""Require actual same-execution Go events for the original EVM adapter."""
import json
import sys

REQUIRED = {
    "chain": (
        "TestStaticEVMCallerRequiresOriginalContext",
        "TestStaticPinnedERC20CallerFailsClosed",
    ),
    "consensus": (
        "TestOriginalEthereumAdapterPublicWireCompatibility",
        "TestOriginalEthereumAdapterExecutionAndColdRestart",
        "TestOriginalEthereumAdapterPaddedGasBudget",
    ),
    "bftgateway": (
        "TestEVMUnversionedValueUnitsHeldBeforeBroadcast",
        "TestEVMOriginalBalanceUnitCompatibility",
        "TestEVMAccountReadRejectsSnapshotHeightMismatch",
        "TestEVMContractReadRejectsSnapshotHeightMismatch",
        "TestEVMOriginalEstimatePinsSenderHeight",
        "TestEVMMigratedContractOriginalReads",
        "TestGatewayCommitsBoundedIDEAndReturnsEVMLogs",
        "TestEVMMigratedContractPQUpdateReadAndRestart",
        "TestGatewayOriginalEVMLogsCrossMigrationAndColdRead",
        "TestGatewayOriginalEthereumTransactionAndUnavailableReceipt",
        "TestGatewayImportedEVMBlocksActualSourceAndColdRead",
        "TestGatewayImportedEVMBlockBadSourceNeverFallsBack",
        "TestEVMNativeSignedTransferProjectionUsesWei",
        "TestEVMOriginalSignedTransactionAndReceiptUnits",
        "TestEVMOriginalSignedBroadcastAndReadback",
        "TestOriginalNativeEthereumEstimateWei",
        "TestOriginalFeeModelConfiguredABCIObservation",
        "TestOriginalFeeModelMissingPolicyFailsClosed",
        "TestGatewayRoutesCommittedFeeHistory",
    ),
}

def qualify(kind, events):
    package = "github.com/JiahaoAlbus/YNX-Chain/internal/" + kind
    required = REQUIRED[kind]
    state = {name: 0 for name in required}
    active = False
    participants = set()
    for e in events:
        if e.get("Package") != package:
            continue
        action, name = e.get("Action"), e.get("Test")
        if action == "start" and name is None:
            if active:
                raise ValueError("overlapping package executions")
            active = True
            participants = set()
        elif name is None and action in ("pass", "fail", "skip"):
            if not active or action != "pass" or any(state[n] != 2 for n in participants):
                raise ValueError("package failed or test did not finish")
            active = False
        elif name:
            top = name.split("/", 1)[0]
            if top not in state:
                continue
            if not active or action in ("skip", "fail"):
                raise ValueError("required test skipped, failed, or outside package")
            if name != top and state[top] != 1:
                raise ValueError("required child event outside parent run")
            if name == top and action == "run":
                if state[top] != 0:
                    raise ValueError("duplicate required test")
                state[top] = 1
                participants.add(top)
            elif name == top and action == "pass":
                if state[top] != 1:
                    raise ValueError("required test passed without run")
                state[top] = 2
    if active or any(value != 2 for value in state.values()):
        raise ValueError("required original Ethereum test missing or unfinished")

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in REQUIRED:
        raise SystemExit("usage: qualify_original_ethereum_ci.py chain|consensus|bftgateway EVENTS.jsonl")
    with open(sys.argv[2], encoding="utf-8") as stream:
        qualify(sys.argv[1], (json.loads(line) for line in stream))
