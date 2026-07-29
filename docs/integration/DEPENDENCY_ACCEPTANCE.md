# YNX Trust Center Dependency Acceptance

## Acceptance state

| Dependency | Owner | Current state | Acceptance gate |
|---|---|---|---|
| Canonical Wallet product session | 02 Wallet/Auth | Contract adapter tested locally | Exact client/device/scope/expiry/revoke vectors pass in shared Testnet |
| Central App Gateway registration | 29 Integration | Not registered in this product worktree | `ynx-trust-center-v1` and routes are frozen and deployed with no wildcard scope |
| Governance request authority | 31 Governance | Product proxy implemented locally | Authoritative submit/read/review/reject responses pass and retain source/version/audit identity |
| Trust evidence and appeal authority | 15 Trust + 29 Integration | Product proxy implemented locally | Evidence and appeal vectors pass, including replay and role separation |
| AI explanation provider | 14 AI | Optional adapter tested locally | Provider-backed run succeeds or accurately reports unavailable; no mutation authority |
| Canonical events | 26 Data Fabric | Candidate event names only | Integration freezes event schema/version and validates downstream ingestion |
| Public product route | 28 Website | Metadata candidate only | Canonical URL, support/privacy/security/status and public proof exist |
| Artifact/release controls | 30 Security/SRE | Source-bound CI, hosted unsigned preview, SBOM, provenance, checksums and local restore evidence exist | Accept production provenance, encrypted remote custody, independent restore, immutable release policy and signing class |

## Required invariants

Acceptance must preserve all of the following:

1. Trust Center cannot freeze, seize, blacklist, confiscate or transfer native YNXT.
2. A request rejected as illegal or overbroad cannot be overridden to `valid` by a reviewer.
3. Evidence used by the local conclusion workflow is bounded, sourced and visible to the subject.
4. The case owner cannot review their own request.
5. The initial reviewer cannot resolve the appeal.
6. False-positive correction disables any active label and emits notice/audit evidence.
7. Central authority unavailability returns an explicit retryable failure and never substitutes local success.
8. AI cannot mutate evidence, decisions, labels, appeals, permissions or assets.
9. Persisted state is integrity-verified before admission.
10. Subject export is exact-read-scoped and excludes other subjects, central sessions, replay internals and persistence seals.
11. Backup restore rejects unsafe source modes, tampering and overwrite, then proves a clean cold start.
12. Release-state booleans remain evidence-backed and independent.

## Rejection conditions

Integration acceptance must fail when any of these are observed:

- wildcard or widened scope;
- session accepted from a different device or client;
- missing expiry or revoke semantics;
- local static success when the central authority is unavailable;
- raw session token or private evidence payload in logs/audit;
- reviewer self-approval or appeal-reviewer conflict;
- illegal native-asset request accepted;
- persisted state accepted after offline tampering;
- AI output treated as a final decision;
- Testnet, local build or simulator state described as production/public/store state.

## Evidence required from accepting owners

The accepting owner must return:

- exact source and deployed release commits;
- registry and route configuration digest;
- executed vector IDs and pass/fail results;
- request, error and audit IDs with secrets removed;
- health/version responses;
- rollback and recovery evidence;
- direct public or shared-Testnet proof where applicable;
- explicit unresolved blockers.

## Current decision

`NOT ACCEPTED FOR CENTRAL INTEGRATION`

Reason: the product candidate has exact route-level scope enforcement, subject export, verified backup/restore, successful source-bound CI and a hosted unsigned Testnet preview. Central client registration, authoritative shared-Testnet vectors, policy-approved deletion/retention, production release acceptance and the canonical ynxweb4.com deployment remain incomplete.
