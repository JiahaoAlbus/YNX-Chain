#!/usr/bin/env python3
"""Validate the current Quant product integration without global singleton files."""

from __future__ import annotations

import json
import pathlib
import re
import sys
from typing import Any, NoReturn

ROOT = pathlib.Path(__file__).resolve().parents[3]
PRODUCT = ROOT / "apps/quant-lab"
PATHS = {
    "release": PRODUCT / "product-release.json",
    "metadata": PRODUCT / "public-product-metadata.json",
    "registry": PRODUCT / "integration/wallet-registry-entry.json",
    "central": PRODUCT / "integration/central-integration.json",
    "evidence": PRODUCT / "evidence/public-wallet-quant-exchange-20260810.json",
    "contract": ROOT / "release/integration/ynx-quant-lab-contract.json",
}
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SCOPES = [
    "quant:account",
    "quant:mandate:create",
    "quant:mandate:execute",
    "quant:mandate:revoke",
]
PROTOCOLS = {
    "productSession": 1,
    "productSessionHttpProof": 1,
    "strategyMandate": 2,
    "strategyAction": 1,
}


def fail(message: str) -> NoReturn:
    raise SystemExit(f"integration package invalid: {message}")


def load(name: str) -> dict[str, Any]:
    path = PATHS[name]
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"missing {path.relative_to(ROOT)}")
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON in {path.relative_to(ROOT)}: {exc}")
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)} must contain an object")
    return value


def require_sha(value: Any, label: str, pattern: re.Pattern[str] = SHA40) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        fail(f"{label} must be a lowercase hexadecimal digest")
    return value


def validate_release(release: dict[str, Any], metadata: dict[str, Any]) -> None:
    if release.get("productId") != "ynx-quant-lab":
        fail("release product identity mismatch")
    require_sha(release.get("sourceCommit"), "release.sourceCommit")
    required_true = (
        "implementedLocal", "testedLocal", "installedLocal", "integratedCentral",
        "deployedPublic", "downloadHosted",
    )
    for field in required_true:
        if release.get(field) is not True:
            fail(f"release.{field} must be true")
    for field in ("deployedStaging", "productionSigned", "storeReleased"):
        if release.get(field) is not False:
            fail(f"release.{field} must remain false")
    runtime = release.get("publicRuntime")
    if not isinstance(runtime, dict):
        fail("release.publicRuntime is missing")
    if runtime.get("mode") != "simulated_testnet_only" or runtime.get("liveFundsEnabled") is not False:
        fail("public runtime must remain simulated Testnet only with live funds disabled")
    require_sha(runtime.get("sourceCommit"), "release.publicRuntime.sourceCommit")
    require_sha(runtime.get("binarySha256"), "release.publicRuntime.binarySha256", SHA256)
    if runtime.get("canonicalWalletExchangeE2E") is not True or runtime.get("productProofReplayStatus") != 401:
        fail("public runtime Wallet/Exchange proof is incomplete")

    artifacts = release.get("artifacts")
    downloads = metadata.get("downloads")
    if not isinstance(artifacts, list) or not isinstance(downloads, list) or len(downloads) != 2:
        fail("exactly two hosted desktop downloads are required")
    hosted = [item for item in artifacts if isinstance(item, dict) and item.get("hosted") is True]
    if len(hosted) != 2:
        fail("release must expose exactly two hosted artifacts")
    by_url = {item.get("url"): item for item in hosted}
    for download in downloads:
        if not isinstance(download, dict) or download.get("url") not in by_url:
            fail("metadata download is not backed by a release artifact")
        artifact = by_url[download["url"]]
        for field in ("sourceCommit", "bytes", "sha256"):
            if download.get(field) != artifact.get(field):
                fail(f"download {field} disagrees with release artifact")
        require_sha(artifact.get("sourceCommit"), "artifact.sourceCommit")
        require_sha(artifact.get("sha256"), "artifact.sha256", SHA256)
        if not isinstance(artifact.get("bytes"), int) or artifact["bytes"] <= 0:
            fail("artifact bytes must be positive")


def validate_registry(registry: dict[str, Any]) -> None:
    expected = {
        "schemaVersion": 3,
        "productId": "quant",
        "productClientId": "ynx-quant-v1",
        "requestingProduct": "quant",
        "bundleId": "com.ynxweb4.quant",
        "reviewState": "approved",
        "enabled": True,
    }
    for field, value in expected.items():
        if registry.get(field) != value:
            fail(f"registry.{field} mismatch")
    if registry.get("scopes") != SCOPES or registry.get("maxScopes") != len(SCOPES):
        fail("registry scopes mismatch")
    if registry.get("protocolVersions") != PROTOCOLS:
        fail("registry protocol versions mismatch")
    callbacks = registry.get("callbacks")
    if callbacks != ["https://quant.ynxweb4.com/wallet-auth/callback", "ynxquant://wallet-auth/callback"]:
        fail("registry callbacks mismatch")
    owner = registry.get("ownerCandidate")
    if not isinstance(owner, dict):
        fail("registry ownerCandidate is missing")
    require_sha(owner.get("contractSourceCommit"), "registry owner source")
    for field in ("sourceCommitReachableFromObservedHead", "exactHeadBound", "centrallyAccepted", "directTestnetMandateReceipt"):
        if owner.get(field) is not True:
            fail(f"registry ownerCandidate.{field} must be true")


def validate_central(central: dict[str, Any], registry: dict[str, Any], evidence: dict[str, Any]) -> None:
    if central.get("schemaVersion") != 3 or central.get("productId") != "ynx-quant-lab":
        fail("central integration identity or schema mismatch")
    if central.get("walletProtocolVersions") != PROTOCOLS:
        fail("central Wallet protocol versions mismatch")
    if central.get("walletAuthSourceCommit") != registry["ownerCandidate"]["contractSourceCommit"]:
        fail("central Wallet source disagrees with registry")
    if central.get("walletAuthExactHeadBound") is not True:
        fail("central Wallet source is not exact-head bound")
    for field in ("integratedCentral", "testnetExecutionEnabled", "sharedTestnetVerified"):
        if central.get(field) is not True:
            fail(f"central.{field} must be true")
    if central.get("liveFundsEnabled") is not False:
        fail("central liveFundsEnabled must remain false")
    acceptance = central.get("centralAcceptance")
    sources = evidence.get("sources")
    if not isinstance(acceptance, dict) or not isinstance(sources, dict):
        fail("central acceptance or evidence sources missing")
    mapping = {
        "walletSourceCommit": "wallet",
        "exchangeSourceCommit": "exchange",
        "quantSourceCommit": "quant",
    }
    for acceptance_field, evidence_field in mapping.items():
        require_sha(acceptance.get(acceptance_field), f"centralAcceptance.{acceptance_field}")
        if acceptance[acceptance_field] != sources.get(evidence_field):
            fail(f"central acceptance {acceptance_field} disagrees with public evidence")
    evidence_path = ROOT / str(acceptance.get("publicEvidence", ""))
    if evidence_path.resolve() != PATHS["evidence"].resolve():
        fail("central publicEvidence path mismatch")


def validate_evidence(evidence: dict[str, Any]) -> None:
    if evidence.get("schemaVersion") != "ynx.quant.public-wallet-exchange-evidence.v1":
        fail("public evidence schema mismatch")
    public = evidence.get("publicEndToEnd")
    users = evidence.get("multiUser")
    if not isinstance(public, dict) or public.get("result") != "pass":
        fail("public end-to-end result is not pass")
    if public.get("productProofReplayStatus") != 401 or public.get("quantRegistry") != "approved_enabled":
        fail("public proof replay or registry evidence mismatch")
    if not isinstance(users, dict):
        fail("multi-user evidence is missing")
    writes = users.get("candidateConcurrentPersistentTenantWrites")
    if writes != {"passed": 100, "attempted": 100}:
        fail("100-user persistent tenant write evidence is incomplete")
    for region in ("publicSingapore", "publicSeoul"):
        sample = users.get(region)
        if not isinstance(sample, dict) or set(sample.values()) != {"100/100"}:
            fail(f"{region} 100-user public evidence is incomplete")


def validate_contract(contract: dict[str, Any]) -> None:
    if contract.get("contractId") != "ynx-quant-lab-contract-v1":
        fail("historical contract identity mismatch")
    if contract.get("contractState") != "superseded-by-central-integration-v3":
        fail("historical owner proposal is not marked superseded")
    if contract.get("authority") != "historical-owner-proposal":
        fail("historical contract authority is ambiguous")
    if contract.get("supersededBy") != "apps/quant-lab/integration/central-integration.json":
        fail("historical contract supersession target mismatch")


def main() -> int:
    values = {name: load(name) for name in PATHS}
    validate_release(values["release"], values["metadata"])
    validate_registry(values["registry"])
    validate_evidence(values["evidence"])
    validate_central(values["central"], values["registry"], values["evidence"])
    validate_contract(values["contract"])
    print(json.dumps({
        "product": "ynx-quant-lab",
        "centralIntegrated": True,
        "sharedTestnetVerified": True,
        "liveFundsEnabled": False,
        "hostedDownloads": 2,
        "multiUserPersistentWrites": 100,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
