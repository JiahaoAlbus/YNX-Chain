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


def validate_contract(contract: dict[str, Any], release: dict[str, Any], registry: dict[str, Any]) -> None:
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

    registration = contract.get("productRegistration")
    if not isinstance(registration, dict):
        fail("missing productRegistration")
    for field in ("productClientId", "bundleId", "callback", "reviewState", "enabled"):
        expected = registry.get(field if field != "callback" else "callbacks")
        actual = registration.get(field)
        if field == "callback":
            expected = expected[0] if isinstance(expected, list) and expected else None
        if actual != expected:
            fail(f"productRegistration.{field} disagrees with wallet registry entry")
    if registration.get("enabled") is not False or registration.get("reviewState") != "pending-review":
        fail("pending Wallet registry entry must remain disabled")

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


def validate_vectors(vectors_doc: dict[str, Any]) -> None:
    if vectors_doc.get("schemaVersion") != "ynx.cross-product-test-vectors.v1":
        fail("unexpected test-vector schemaVersion")
    if vectors_doc.get("contractId") != "ynx-quant-lab-contract-v1":
        fail("test vectors do not reference the Quant contract")
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
    validate_contract(contract, release, registry)
    validate_vectors(vectors)
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
