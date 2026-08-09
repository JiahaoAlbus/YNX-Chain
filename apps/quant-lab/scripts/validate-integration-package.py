#!/usr/bin/env python3
"""Validate the Quant integration package without external dependencies."""

from __future__ import annotations

import json
import pathlib
import re
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "release/integration/ynx-quant-lab-contract.json"
VECTORS_PATH = ROOT / "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json"
HANDOFF_PATH = ROOT / "docs/integration/INTEGRATION_HANDOFF.md"
ACCEPTANCE_PATH = ROOT / "docs/integration/DEPENDENCY_ACCEPTANCE.md"
COVERAGE_PATH = ROOT / ".ai-bridge/full-goal-coverage.json"
RELEASE_PATH = ROOT / "apps/quant-lab/product-release.json"
REGISTRY_PATH = ROOT / "apps/quant-lab/integration/wallet-registry-entry.json"
CENTRAL_PATH = ROOT / "apps/quant-lab/integration/central-integration.json"
OWNER_SNAPSHOT_PATH = ROOT / "apps/quant-lab/integration/owner-contract-snapshot.json"

SHA40 = re.compile(r"^[0-9a-f]{40}$")
ALLOWED_COVERAGE_STATUSES = {
    "notStarted",
    "inProgress",
    "implementedLocal",
    "testedLocal",
    "integratedCentral",
    "testnetVerified",
    "publicVerified",
    "externalBlocked",
    "notApplicable",
    "verifiedComplete",
}
RELEASE_FIELDS = (
    "implementedLocal",
    "testedLocal",
    "installedLocal",
    "integratedCentral",
    "deployedStaging",
    "deployedPublic",
    "downloadHosted",
    "productionSigned",
    "storeReleased",
)
REQUIRED_DEPENDENCIES = {
    "01-chain-core",
    "02-wallet-auth",
    "07-exchange",
    "12-explorer",
    "13-monitor",
    "15-trust-center",
    "19-oracle-market-data",
    "24-finance",
    "26-data-fabric",
    "27-dex",
    "29-integration",
    "30-security-sre-release",
}
REQUIRED_VECTOR_FIELDS = {
    "id",
    "category",
    "owners",
    "preconditions",
    "action",
    "expected",
    "status",
    "requiredEvidence",
}
REQUIRED_OWNER_PRODUCTS = {"02", "07", "19", "26", "27"}
EXPECTED_WALLET_SCOPES = [
    "quant:account",
    "quant:mandate:create",
    "quant:mandate:execute",
    "quant:mandate:revoke",
]
EXPECTED_WALLET_PROTOCOLS = {
    "productSession": 1,
    "productSessionHttpProof": 1,
    "strategyMandate": 2,
    "strategyAction": 1,
}
REQUIRED_COVERAGE_FIELDS = {
    "id",
    "category",
    "requirement",
    "applicability",
    "status",
    "evidence",
    "sourceCommit",
    "tests",
    "artifact",
    "publicProof",
    "blockedBy",
    "owner",
    "nextAction",
    "lastUpdated",
}


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"integration package invalid: {message}")


def load_json(path: pathlib.Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"missing {path.relative_to(ROOT)}")
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON in {path.relative_to(ROOT)}: {exc}")
    if not isinstance(value, dict):
        fail(f"top-level JSON must be an object: {path.relative_to(ROOT)}")
    return value


def require_nonempty_text(value: Any, label: str) -> None:
    if not isinstance(value, str) or not value.strip():
        fail(f"{label} must be non-empty text")


def require_nonempty_list(value: Any, label: str) -> None:
    if not isinstance(value, list) or not value:
        fail(f"{label} must be a non-empty list")


def owner_contract(snapshot: dict[str, Any], product_number: str) -> dict[str, Any]:
    contracts = snapshot.get("ownerContracts")
    require_nonempty_list(contracts, "ownerContracts")
    matches = [
        item
        for item in contracts
        if isinstance(item, dict) and item.get("productNumber") == product_number
    ]
    if len(matches) != 1:
        fail(f"owner snapshot must contain exactly one product {product_number} contract")
    return matches[0]


def validate_owner_snapshot(snapshot: dict[str, Any]) -> None:
    if snapshot.get("schemaVersion") != "ynx.quant.owner-contract-snapshot.v1":
        fail("unexpected owner-contract snapshot schemaVersion")
    if snapshot.get("productId") != "ynx-quant-lab":
        fail("owner-contract snapshot product identity mismatch")
    checkpoint = snapshot.get("observedFromQuantCheckpoint")
    if not isinstance(checkpoint, str) or not SHA40.fullmatch(checkpoint):
        fail("owner-contract snapshot checkpoint must be a full lowercase SHA")

    central = snapshot.get("centralIntegration")
    if not isinstance(central, dict):
        fail("owner-contract snapshot is missing centralIntegration")
    if central.get("centrallyAcceptedProducts") != 0:
        fail("owner snapshot cannot claim centrally accepted products")
    if central.get("quantAcceptedSourceCommit") is not None:
        fail("owner snapshot cannot claim an accepted Quant source commit")
    if central.get("quantIntegratedCentral") is not False:
        fail("owner snapshot cannot claim Quant central integration")
    if central.get("quantSharedTestnetVerified") is not False:
        fail("owner snapshot cannot claim shared Testnet verification")

    contracts = snapshot.get("ownerContracts")
    require_nonempty_list(contracts, "ownerContracts")
    products = {
        item.get("productNumber")
        for item in contracts
        if isinstance(item, dict)
    }
    if products != REQUIRED_OWNER_PRODUCTS:
        fail(f"owner snapshot product set mismatch: {sorted(products)}")
    for item in contracts:
        if not isinstance(item, dict):
            fail("ownerContracts entries must be objects")
        for field in ("observedBranchHead", "contractSourceCommit"):
            value = item.get(field)
            if not isinstance(value, str) or not SHA40.fullmatch(value):
                fail(f"owner {item.get('productNumber')} {field} must be a full lowercase SHA")
        if item.get("sourceCommitReachableFromObservedHead") is not True:
            fail(f"owner {item.get('productNumber')} source reachability is not proven")
        if item.get("centrallyAccepted") is not False:
            fail(f"owner {item.get('productNumber')} cannot be marked centrally accepted")
        if item.get("state") != "candidate-not-central":
            fail(f"owner {item.get('productNumber')} state must remain candidate-not-central")
        exact_head_bound = item.get("exactHeadBound")
        if not isinstance(exact_head_bound, bool):
            fail(f"owner {item.get('productNumber')} exactHeadBound must be boolean")
        same_commit = item["observedBranchHead"] == item["contractSourceCommit"]
        if exact_head_bound != same_commit:
            fail(f"owner {item.get('productNumber')} exactHeadBound disagrees with source commits")

    wallet = owner_contract(snapshot, "02")
    if wallet.get("protocolVersions") != EXPECTED_WALLET_PROTOCOLS:
        fail("Wallet owner candidate protocol versions changed")
    registration = wallet.get("quantRegistration")
    expected_registration = {
        "productId": "quant",
        "productClientId": "ynx-quant-v1",
        "bundleId": "com.ynxweb4.quant",
        "callback": "ynxquant://wallet-auth/callback",
        "enabledByDefault": False,
        "reviewState": "pending-review",
        "orderedScopes": EXPECTED_WALLET_SCOPES,
    }
    if registration != expected_registration:
        fail("Wallet owner candidate Quant registration changed")
    shared_vector = wallet.get("sharedVector")
    if not isinstance(shared_vector, dict):
        fail("Wallet owner candidate is missing the shared mandate vector")
    for field in ("mandateDigest", "actionDigest", "actionNonceKey"):
        value = shared_vector.get(field)
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
            fail(f"Wallet shared vector {field} must be a lowercase SHA-256")

    oracle = owner_contract(snapshot, "19")
    if oracle.get("contractId") != "ynx-oracle-market-data-v1":
        fail("Oracle candidate contract changed")
    if "product 09" not in str(oracle.get("knownConflict")):
        fail("Oracle stale DEX owner conflict must remain explicit")

    data_fabric = owner_contract(snapshot, "26")
    mapping = data_fabric.get("quantCandidateMapping")
    if not isinstance(mapping, dict) or mapping.get("integratedCentral") is not False:
        fail("Data Fabric Quant mapping cannot be promoted")
    if mapping.get("eventTypes") != [
        "quant.mandate.activated",
        "quant.pnl.recorded",
        "quant.fee.posted",
        "quant.kill_switch.activated",
    ]:
        fail("Data Fabric Quant candidate event mapping changed")

    dex = owner_contract(snapshot, "27")
    if dex.get("deploymentStatus") != "not-deployed":
        fail("DEX candidate deployment status changed without retained Quant evidence")


def validate_central(
    central: dict[str, Any], snapshot: dict[str, Any], registry: dict[str, Any]
) -> None:
    if central.get("schemaVersion") != 2 or central.get("productId") != "ynx-quant-lab":
        fail("central-integration identity or schema mismatch")
    if central.get("ownerContractSnapshot") != OWNER_SNAPSHOT_PATH.name:
        fail("central-integration must reference the owner-contract snapshot")
    wallet = owner_contract(snapshot, "02")
    if central.get("walletAuthSourceCommit") != wallet.get("contractSourceCommit"):
        fail("central-integration Wallet source disagrees with owner snapshot")
    if central.get("walletAuthObservedBranchHead") != wallet.get("observedBranchHead"):
        fail("central-integration Wallet branch HEAD disagrees with owner snapshot")
    if central.get("walletAuthSourceReachable") is not True:
        fail("central-integration Wallet source reachability must be proven")
    if central.get("walletAuthExactHeadBound") is not False:
        fail("Wallet owner candidate is not bound to the observed branch HEAD")
    if central.get("walletProtocolVersions") != EXPECTED_WALLET_PROTOCOLS:
        fail("central-integration Wallet protocol versions changed")
    if central.get("requiredGatewayRoutes") != wallet.get("gatewayRoutes"):
        fail("central-integration Gateway routes disagree with owner snapshot")
    if central.get("registryEntry") != REGISTRY_PATH.name:
        fail("central-integration registry path mismatch")
    owner_candidate = registry.get("ownerCandidate")
    if not isinstance(owner_candidate, dict):
        fail("Wallet registry is missing ownerCandidate")
    if owner_candidate.get("contractSourceCommit") != central.get("walletAuthSourceCommit"):
        fail("Wallet registry owner candidate disagrees with central-integration")
    acceptance = central.get("centralAcceptance")
    if not isinstance(acceptance, dict):
        fail("central-integration is missing centralAcceptance")
    snapshot_acceptance = snapshot.get("centralIntegration", {})
    if acceptance.get("observedBranchHead") != snapshot_acceptance.get("observedBranchHead"):
        fail("central Integration branch HEAD disagrees with owner snapshot")
    if acceptance.get("centrallyAcceptedProducts") != 0:
        fail("central-integration cannot claim accepted products")
    if acceptance.get("quantAcceptedSourceCommit") is not None:
        fail("central-integration cannot claim an accepted Quant source commit")
    for field in (
        "integratedCentral",
        "testnetExecutionEnabled",
        "sharedTestnetVerified",
        "liveFundsEnabled",
    ):
        if central.get(field) is not False:
            fail(f"central-integration {field} must remain false")


def validate_contract(contract: dict[str, Any], release: dict[str, Any], registry: dict[str, Any], snapshot: dict[str, Any]) -> None:
    if contract.get("schemaVersion") != "ynx.integration.contract.v1":
        fail("unexpected contract schemaVersion")
    if contract.get("contractId") != "ynx-quant-lab-contract-v1" or contract.get("productId") != "ynx-quant-lab":
        fail("contract identity mismatch")
    if contract.get("contractState") != "owner-proposal-integration-pending":
        fail("contract must remain an owner proposal before Integration acceptance")
    source_commit = contract.get("sourceCommit")
    if not isinstance(source_commit, str) or not SHA40.fullmatch(source_commit):
        fail("contract sourceCommit must be a full lowercase SHA")
    if source_commit != release.get("sourceCommit"):
        fail("contract sourceCommit must match product-release sourceCommit")
    evidence_commit = contract.get("evidenceCommit")
    if not isinstance(evidence_commit, str) or not SHA40.fullmatch(evidence_commit):
        fail("contract evidenceCommit must be a full lowercase SHA")
    if contract.get("ownerContractSnapshot") != str(OWNER_SNAPSHOT_PATH.relative_to(ROOT)):
        fail("contract must reference the owner-contract snapshot")

    registration = contract.get("productRegistration")
    if not isinstance(registration, dict):
        fail("missing productRegistration")
    for field in ("productId", "productClientId", "bundleId", "callback", "reviewState", "enabled"):
        expected = registry.get(field if field != "callback" else "callbacks")
        actual = registration.get(field)
        if field == "callback":
            expected = expected[0] if isinstance(expected, list) and expected else None
        if actual != expected:
            fail(f"productRegistration.{field} disagrees with wallet registry entry")
    if registration.get("enabled") is not False or registration.get("reviewState") != "pending-review":
        fail("pending Wallet registry entry must remain disabled")
    if registration.get("centrallyAccepted") is not False:
        fail("Wallet registration cannot be marked centrally accepted")
    if registration.get("ownerCandidateExactHeadBound") is not False:
        fail("Wallet registration candidate is not bound to the observed branch HEAD")
    if registry.get("scopes") != EXPECTED_WALLET_SCOPES:
        fail("Wallet registry scopes changed from the observed owner candidate")
    if registry.get("protocolVersions") != EXPECTED_WALLET_PROTOCOLS:
        fail("Wallet registry protocol versions changed from the observed owner candidate")
    auth = contract.get("auth")
    if not isinstance(auth, dict):
        fail("missing auth contract")
    if auth.get("requiredProductScopes") != registry.get("scopes"):
        fail("auth scopes disagree with the Wallet registry entry")
    if auth.get("protocolVersions") != registry.get("protocolVersions"):
        fail("auth protocol versions disagree with the Wallet registry entry")
    wallet = owner_contract(snapshot, "02")
    if auth.get("requiredGatewayRoutes") != wallet.get("gatewayRoutes"):
        fail("auth Gateway routes disagree with the Wallet owner candidate")
    mandate = contract.get("strategyMandate")
    if not isinstance(mandate, dict):
        fail("missing StrategyMandate contract")
    if mandate.get("schemaVersion") != 2 or mandate.get("actionSchemaVersion") != 1:
        fail("StrategyMandate protocol versions changed")
    shared_vector = mandate.get("sharedVector")
    if not isinstance(shared_vector, dict):
        fail("StrategyMandate shared vector is missing")
    for field in ("mandateDigest", "actionDigest", "actionNonceKey"):
        if shared_vector.get(field) != wallet.get("sharedVector", {}).get(field):
            fail(f"StrategyMandate shared vector {field} disagrees with owner snapshot")
    if shared_vector.get("executedAgainstQuant") is not False:
        fail("StrategyMandate shared vector cannot claim Quant execution")

    release_status = contract.get("releaseStatus")
    if not isinstance(release_status, dict):
        fail("missing releaseStatus")
    for field in RELEASE_FIELDS:
        if release_status.get(field) is not release.get(field):
            fail(f"releaseStatus.{field} disagrees with product-release.json")
    for field in ("integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"):
        if release_status.get(field) is not False:
            fail(f"{field} cannot be true without direct central/public evidence")

    execution = contract.get("execution")
    if not isinstance(execution, dict) or execution.get("schemaVersion") != "ynx.quant.execution.v1":
        fail("execution schema mismatch")
    if execution.get("acceptedTerminalStatuses") != ["filled", "rejected", "cancelled"]:
        fail("terminal status set changed without a contract version change")
    adapters = execution.get("adapters")
    if not isinstance(adapters, dict) or set(adapters) != {"paper", "shadow", "exchange", "dex"}:
        fail("execution adapter set is incomplete")

    oracle = owner_contract(snapshot, "19")
    market_data = contract.get("marketData")
    if not isinstance(market_data, dict):
        fail("missing marketData contract")
    if market_data.get("contractId") != oracle.get("contractId"):
        fail("marketData contract disagrees with the Oracle owner candidate")
    if market_data.get("ownerCandidateSourceCommit") != oracle.get("contractSourceCommit"):
        fail("marketData source disagrees with the Oracle owner candidate")
    if market_data.get("ownerReportedPublicTestnetDoesNotProveQuantIntegration") is not True:
        fail("Oracle owner smoke must not be represented as Quant integration")

    data_fabric = owner_contract(snapshot, "26")
    canonical_events = contract.get("canonicalEvents")
    if not isinstance(canonical_events, dict):
        fail("missing canonicalEvents contract")
    if canonical_events.get("ownerCandidateSourceCommit") != data_fabric.get("contractSourceCommit"):
        fail("canonicalEvents source disagrees with the Data Fabric owner candidate")
    if canonical_events.get("candidateMapping") != data_fabric.get("quantCandidateMapping"):
        fail("canonicalEvents mapping disagrees with the Data Fabric owner candidate")

    dependency_products = {
        item.get("product")
        for item in contract.get("dependencies", [])
        if isinstance(item, dict)
    }
    missing_dependencies = REQUIRED_DEPENDENCIES - dependency_products
    if missing_dependencies:
        fail(f"missing required dependencies: {sorted(missing_dependencies)}")
    if any(item.get("acceptance") != "pending" for item in contract.get("dependencies", []) if isinstance(item, dict)):
        fail("dependency acceptance cannot be promoted in the owner proposal")


def validate_vectors(vectors_doc: dict[str, Any], contract: dict[str, Any]) -> None:
    if vectors_doc.get("schemaVersion") != "ynx.cross-product-test-vectors.v1":
        fail("unexpected test-vector schemaVersion")
    if vectors_doc.get("contractId") != "ynx-quant-lab-contract-v1":
        fail("test vectors do not reference the Quant contract")
    if vectors_doc.get("sourceCommit") != contract.get("sourceCommit"):
        fail("test vectors sourceCommit must match the Quant contract")
    if vectors_doc.get("ownerContractSnapshot") != contract.get("ownerContractSnapshot"):
        fail("test vectors must reference the same owner-contract snapshot")
    if vectors_doc.get("state") != "owner-proposal-not-yet-executed-on-shared-testnet":
        fail("test-vector document must not claim shared Testnet execution")
    vectors = vectors_doc.get("vectors")
    require_nonempty_list(vectors, "vectors")
    ids: set[str] = set()
    companions: list[tuple[str, str]] = []
    for index, vector in enumerate(vectors):
        if not isinstance(vector, dict):
            fail(f"vectors[{index}] must be an object")
        missing = REQUIRED_VECTOR_FIELDS - vector.keys()
        if missing:
            fail(f"vectors[{index}] missing fields: {sorted(missing)}")
        vector_id = vector["id"]
        require_nonempty_text(vector_id, f"vectors[{index}].id")
        if vector_id in ids:
            fail(f"duplicate vector id {vector_id}")
        ids.add(vector_id)
        require_nonempty_list(vector["owners"], f"{vector_id}.owners")
        require_nonempty_list(vector["preconditions"], f"{vector_id}.preconditions")
        require_nonempty_text(vector["action"], f"{vector_id}.action")
        require_nonempty_list(vector["expected"], f"{vector_id}.expected")
        require_nonempty_list(vector["requiredEvidence"], f"{vector_id}.requiredEvidence")
        status = vector["status"]
        if not isinstance(status, str) or not status.startswith("pending-"):
            fail(f"{vector_id} cannot be promoted before retained shared-environment evidence")
        companion = vector.get("negativeCompanion")
        if companion is not None:
            require_nonempty_text(companion, f"{vector_id}.negativeCompanion")
            companions.append((vector_id, companion))
    for vector_id, companion in companions:
        if companion not in ids:
            fail(f"{vector_id} references missing negative companion {companion}")


def validate_coverage(coverage: dict[str, Any]) -> None:
    if coverage.get("productNumber") != "08" or coverage.get("productSlug") != "ynx-quant-lab":
        fail("coverage matrix product identity mismatch")
    if coverage.get("currentStage") != "INTEGRATE":
        fail("coverage matrix must reflect the current INTEGRATE stage")
    entries = coverage.get("entries")
    require_nonempty_list(entries, "coverage entries")
    ids: set[str] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            fail(f"coverage entry {index} must be an object")
        missing = REQUIRED_COVERAGE_FIELDS - entry.keys()
        if missing:
            fail(f"coverage entry {index} missing fields: {sorted(missing)}")
        entry_id = entry["id"]
        require_nonempty_text(entry_id, f"coverage entry {index}.id")
        if entry_id in ids:
            fail(f"duplicate coverage id {entry_id}")
        ids.add(entry_id)
        if entry["status"] not in ALLOWED_COVERAGE_STATUSES:
            fail(f"{entry_id} has unsupported status {entry['status']}")
        require_nonempty_text(entry["requirement"], f"{entry_id}.requirement")
        require_nonempty_text(entry["owner"], f"{entry_id}.owner")
        require_nonempty_text(entry["nextAction"], f"{entry_id}.nextAction")
        source_commit = entry["sourceCommit"]
        if not isinstance(source_commit, str) or not SHA40.fullmatch(source_commit):
            fail(f"{entry_id}.sourceCommit must be a full lowercase SHA")
        for list_field in ("evidence", "tests", "artifact", "publicProof", "blockedBy"):
            if not isinstance(entry[list_field], list):
                fail(f"{entry_id}.{list_field} must be a list")
        if entry["status"] in {"integratedCentral", "testnetVerified", "publicVerified", "verifiedComplete"}:
            fail(f"{entry_id} is promoted beyond available evidence")
        if entry["status"] == "externalBlocked" and not entry["blockedBy"]:
            fail(f"{entry_id} externalBlocked requires a concrete blocker")


def validate_documents() -> None:
    for path, heading in (
        (HANDOFF_PATH, "# YNX Quant Lab Integration Handoff"),
        (ACCEPTANCE_PATH, "# YNX Quant Lab Dependency Acceptance"),
    ):
        try:
            text = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            fail(f"missing {path.relative_to(ROOT)}")
        if heading not in text:
            fail(f"unexpected or empty document {path.relative_to(ROOT)}")
        for forbidden_claim in ("integratedCentral: true", "deployedPublic: true", "productionSigned: true", "storeReleased: true"):
            if forbidden_claim in text:
                fail(f"premature claim in {path.relative_to(ROOT)}: {forbidden_claim}")


def main() -> int:
    contract = load_json(CONTRACT_PATH)
    vectors = load_json(VECTORS_PATH)
    coverage = load_json(COVERAGE_PATH)
    release = load_json(RELEASE_PATH)
    registry = load_json(REGISTRY_PATH)
    central = load_json(CENTRAL_PATH)
    owner_snapshot = load_json(OWNER_SNAPSHOT_PATH)
    validate_owner_snapshot(owner_snapshot)
    validate_central(central, owner_snapshot, registry)
    validate_contract(contract, release, registry, owner_snapshot)
    validate_vectors(vectors, contract)
    validate_coverage(coverage)
    validate_documents()
    print(
        json.dumps(
            {
                "contract": contract["contractId"],
                "coverageEntries": len(coverage["entries"]),
                "testVectors": len(vectors["vectors"]),
                "centralIntegrated": contract["releaseStatus"]["integratedCentral"],
                "sharedTestnetVerified": False,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
