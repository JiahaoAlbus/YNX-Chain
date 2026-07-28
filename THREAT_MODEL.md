# YNX Trust Center threat model

Status: local Testnet candidate

Owner: `15-trust-center`

Runtime evidence commit: `413ce425c1d5bd43d89bb3813209840d8320f1f3`

Release evidence commit: `cb1dcbc8cba432e90fe9b58870bcfbe67896c1f3`

## Assets and trust boundaries

The protected assets are case evidence, subject-visible explanations, reviews,
appeals, labels, audit events, replay state, Wallet session authority, and the
sealed persistent snapshot. Trust Center does not own Wallet credentials,
private keys, provider secrets, or the canonical central identity registry.

Requests cross five boundaries:

1. Wallet/Auth issues a product-bound session with exact route scopes.
2. The HTTP surface validates size, method, subject, scope, replay, and content
   before calling the Trust service.
3. The service admits only bounded evidence and persists a SHA-256-sealed,
   versioned state snapshot.
4. Optional AI explanation calls are advisory and cannot mutate case outcomes.
5. Backup and restore operate on immutable, hash-bound state without overwrite.

## Threats and controls

| Threat | Required control and evidence | Residual boundary |
|---|---|---|
| Cross-product, wildcard, duplicate, expired, or insufficient authority | Exact Wallet product/scope checks and fail-closed authority proxy tests | Canonical Gateway registration and shared-Testnet execution remain external |
| Cross-subject evidence or export disclosure | Subject binding, bounded normalization, explicit export omission policy, `no-store`, and cross-subject tests | Approved retention/deletion exceptions are not yet frozen |
| Evidence flooding or malicious payloads | Request/body/evidence count and byte limits; unknown fields and invalid native-YNXT requests rejected | Public DAST and sustained hostile traffic evidence remain absent |
| Reviewer self-approval or appeal capture | Reviewer and appeal-reviewer separation; immutable audit trail | Central role assignment remains externally owned |
| Label persistence after correction or expiry | Finite expiry and appeal correction deactivate the label | Scheduled public operator proof remains absent |
| State rollback, tamper, partial write, or unsafe restore | Versioned sealed snapshots, atomic write, immutable backup manifest, hash checks, safe permissions, no overwrite, and cold-start equivalence | Encrypted off-host custody and independent recovery remain external |
| Replay after restart or restore | Replay state is persisted inside the sealed snapshot and included in restore verification | Cross-region disaster recovery is not proven |
| AI prompt injection or unauthorized mutation | AI receives bounded advisory context; provider failure is explicit; case mutation is not exposed to the AI path | Accepted central AI Gateway and provider review remain external |
| Secret or dependency compromise in released binaries | Focused secret/placeholder scan, `go mod verify`, linked-module license review, CycloneDX SBOM, pinned Go 1.25.12 vulnerability scan, deterministic double build, checksums, and local provenance | Evidence is local, unsigned, unhosted, and not an independent attestation |
| Artifact substitution | SHA-256/byte manifest, deterministic archive, clean-source provenance, local install and health build identity | Production signing, notarization, immutable hosting, and store review remain external |

## Release decision

The local Trust server and backup CLI are eligible only for the documented
unsigned/adhoc local Testnet class. Public deployment, production signing,
hosted download, central integration, destructive data deletion, and
production disaster-recovery claims remain prohibited until their named
external owners provide direct evidence.
