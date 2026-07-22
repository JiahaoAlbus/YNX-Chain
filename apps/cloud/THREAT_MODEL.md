# YNX Cloud threat model and security boundaries

Version: 1. Scope: the shared Cloud/Docs control plane, Web/PWA clients, native clients, JavaScript SDK, local/remote object-store adapter boundary, Wallet verifier, scanner, AI gateway, Trust sink, recovery archive, telemetry, and Testnet Preview artifacts.

## Assets and authorities

- The user Wallet and canonical Wallet service are authoritative for account identity, product approval, device binding, scope, expiry, and revocation. Cloud never receives a seed or private key.
- Cloud is authoritative for object metadata, product boundary, immutable version hashes, ACLs, links, quota, usage counters, AI consent records, audit, retention, deletion state, and portability manifests.
- The configured object store is authoritative only for stored bytes and provider availability. Every accepted read/direct completion remains bound to Cloud-recorded SHA-256, size, and scan status.
- AI output is untrusted advisory content. It cannot sign, share, delete, alter ACLs, overwrite source objects, or execute financial actions.
- Provider SLA, durability, cost, erasure, residency, and billing evidence are external claims and remain unavailable until an approved provider contract and remote evidence exist.

## Trust boundaries

1. Browser/native/SDK → control plane: hostile input, strict JSON/body limits, canonical product session, exact scopes, rate limit, and bounded concurrency.
   Product-account erasure additionally requires the dedicated `data.delete` scope and exact product-bound destructive confirmation; ordinary read/write sessions cannot invoke it.
2. Wallet verifier → control plane: authenticated operator channel; unavailable, replayed, mutated, wrong-product, wrong-bundle, wrong-device, widened-scope, expired, or revoked assertions fail closed.
3. Control plane → object store/scanner: operator-only credentials, bounded responses, checksum and size verification, accepted scan status, no signed-URL persistence, exact upload origin.
4. Control plane → AI gateway: explicit selected object/version consent, encrypted-content exclusion, provider/model/estimate state, cancel, review, and audit.
5. Control plane → Trust sink: asynchronous evidence copy only; Trust cannot replace local authorization or make a failed mutation succeed.
6. Live data → recovery/export: operator recovery archives and user portability exports have distinct schemas, integrity checks, permissions, and restore destinations.
7. Cloud ↔ Docs: shared process but distinct Wallet products, sessions, objects, listings, usage, audit, AI jobs, exports, access decisions, and deletion records.

## Threats and implemented controls

| Threat | Control | Residual boundary |
| --- | --- | --- |
| Session theft/replay | Memory-only Web token, hashed server token, short expiry, nonce/challenge consumption, device signature, central verification, revoke | Compromised active device remains usable until revoke/expiry |
| Cross-product confused deputy | Exact product/client/bundle/callback/scope binding plus schema-v3 product ownership and route guards | Central multi-surface registrations still pending |
| IDOR/ACL escalation | Every object route resolves actor role and product; grants are role/expiry bounded; ownership cannot be transferred | No external penetration-test evidence |
| Public data exposure | Private by default; random hashed capability links with role, expiry, and revoke; no object-store URL returned except bounded direct PUT | A stolen unexpired link remains a capability |
| Tampered/corrupt bytes | Content-addressed SHA-256, size checks, verified reads, direct completion contract, recovery manifest integrity | SHA-256 is integrity evidence, not proof of provider durability |
| Malware/resource exhaustion | Scanner boundary, MIME/name/body limits, multipart part/count/size bounds, direct-upload verification, rate limit, backpressure | Local EICAR policy is not production antivirus |
| Path traversal/symlink recovery attack | Generated blob refs, validated paths, regular-file-only backup, empty restore destination, bounded archive size | Operator filesystem compromise is outside process isolation |
| Silent/early deletion | Trash plus exact confirmation, owner-only permanent delete, legal hold/retention enforcement, dedup reference count, provider pending/retry record | Provider media sanitization is unproven |
| AI data overreach/action | Explicit selected versions, encrypted exclusion, bounded modes, no action tools, review/reject, citations, audit | Provider retention/legal terms are not approved |
| Secret leakage | Credentials only from operator environment; signed URLs and provider refs redacted; logs/traces exclude bodies and raw paths; source secret gate | Host/process memory and operator environment need platform controls |
| Telemetry poisoning/cardinality | Authenticated diagnostics, normalized route templates, bounded traces, integrity-checked atomic telemetry | Single-replica telemetry has no remote immutable sink |
| Supply-chain substitution | Exact Go/pnpm locks, lifecycle-script allowlist, deterministic SBOM, artifact hash/size/signing-class gate | No production signer, hosted immutable artifact, container scan, or SLSA attestation |
| Service cessation lock-in | Product-scoped verified export and user-exit mode preserving read/export/revoke/delete | Public exit drill and support/status communication are absent |

## Abuse cases and tests

Authoritative local vectors cover Wallet replay/tamper/wrong bindings/scope widening/expiry/revoke, cross-product object and secondary-surface access, strict JSON, invalid ranges, share expiry/revoke, quota, malware marker, provider mismatch/failure, direct-upload origin, retention, legal hold, telemetry tamper, recovery tamper, rate limit, and backpressure. The security gate scans production/runtime surfaces and verifies lockfiles, script allowlists, machine-readable security artifacts, and exact APK manifest evidence.

## Unresolved release blockers

No production object-store/KMS/scanner/CDN/AI/billing/support provider is approved. There is no external DAST/penetration test, multi-region recovery drill, container image, production signing asset, hosted immutable download, hosted monitor/dashboard, status page, or public endpoint. Those absences keep staging/public/signing/store claims false.
