# YNX Monitor Decision Log

## 2026-07-29 — Bind local security evidence to an implementation source

Decision: use `5914e02134cd17ad20c6d8c9846864861cdfd4a3` as the protected implementation source for the threat model and generated supply-chain evidence.

Reason: generated evidence must identify the exact code that implements the gate. Later documentation and checkpoint commits do not change the protected runtime implementation.

## 2026-07-29 — Do not trust the shared secret-scan success without its dependency

Decision: Monitor uses a built-in Node credential scanner over tracked text files and does not treat the shared `scripts/validate/secret-scan.sh` output as direct evidence when `rg` is unavailable.

Reason: the shared script invokes `rg` in an `if` condition and can continue to print `secret scan passed` after `rg: command not found`. Modifying the central script is outside the Monitor owner boundary; the defect is handed to Security/SRE.

## 2026-07-29 — Disclose registry mirror use

Decision: dependency review records every lock-file registry host, including `registry.npmmirror.com`, rather than normalizing or hiding it.

Reason: provenance and dependency acceptance must reflect the actual resolved supply chain. Central Security/SRE must accept or replace the mirror before hosted artifact publication.

## 2026-07-29 — Keep provenance explicitly local and unsigned

Decision: generated provenance states `hermetic: false`, `networkIsolationVerified: false`, and `signed: false`.

Reason: two identical local builds prove reproducibility for the observed inputs, but do not prove a hermetic builder, GitHub-hosted attestation, production signing, installation, or public deployment.

## 2026-07-29 — Product-specific CI without widening runtime authority

Decision: add `.github/workflows/monitor-ci.yml` to run `npm run security:check` and upload source-bound evidence for Monitor changes.

Reason: CI should verify the same local gate while preserving read-only repository permissions. A workflow definition is not itself evidence of a successful run; remote Actions must be checked after push.
