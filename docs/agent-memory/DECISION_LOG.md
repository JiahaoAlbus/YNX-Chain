# Decision Log

Updated: 2026-07-29T02:45:09Z

## D-2026-07-29-01 — Preserve product ownership boundaries

Quant Lab remains the unique Quant Engine. It may consume owner contracts and publish adapters/test vectors, but it does not implement or overwrite Wallet/Auth, Exchange, DEX, Oracle, Data Fabric, Website or central Integration authority.

## D-2026-07-29-02 — Treat artifact hash drift as a release-truth defect

A local archive whose bytes or SHA-256 differs from `product-release.json` fails the release gate. The gate now emits the expected and actual values instead of returning a silent shell failure.

## D-2026-07-29-03 — Bind reproducibility to source and toolchain

The desktop source inputs remained fixed at `8b211d08a67abc9e2b3d3f3254bbc87f4293b08e`, but the current Go 1.25.7 Darwin arm64 environment produced hashes different from the earlier evidence while preserving archive byte counts. Therefore source commit alone is not represented as sufficient provenance. Product metadata records the build toolchain, and the current hashes must reproduce in that environment.

## D-2026-07-29-04 — Make packaged cold start repeatable

MacOS `installedLocal` and `coldStartVerified` are protected by `apps/quant-lab/scripts/verify-desktop-candidate.py`, not by prose alone. The verifier checks archive identity, safe extraction, executable permissions, strict ad-hoc signature, exact source commit, ready health, disabled live funds, metrics, frontend and clean shutdown.

## D-2026-07-29-05 — Do not promote candidate evidence

Ad-hoc signing is not production signing. Cross-compilation is not Windows execution. A local image ID is not a registry manifest digest. Local health is not staging or public deployment. Metadata and handoff are not website deployment.

## D-2026-07-29-06 — Keep central mutation fail closed

Until directly evidenced accepted owner contracts and a shared Testnet manifest exist, Quant may run local preview, paper, shadow and injected transport tests only. It must not claim real Exchange fills, DEX vault actions, Wallet attestation, shared Testnet verification or public execution.

## D-2026-07-29-07 — SHA semantics for committed Agent Memory

A tracked file cannot contain the SHA of the commit that contains itself without changing that SHA. Agent Memory therefore records the last fully verified source checkpoint and provides a Git command to resolve the commit containing the memory record. This avoids invented or perpetually stale self-referential hashes.
