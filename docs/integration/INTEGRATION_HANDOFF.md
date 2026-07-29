# YNX Trust Center Integration Handoff

## Release identity

- Product: `15 | YNX Trust Center`
- Product client: `ynx-trust-center-v1`
- Source branch: `codex/final-trust-center`
- Runtime and hosted artifact source commit: `1baeccada8e72eab8277803973d0e598dcf19b51`
- Current phase: `FREEZE`
- Goal status: `Active`

This handoff describes a locally implemented, tested and installed candidate with a hosted unsigned GitHub Testnet prerelease. It does not claim central integration, authoritative shared-Testnet execution, staging/public deployment, production signing, store release or independent production audit.

## Product boundary

YNX Trust Center owns request-validity checks, bounded evidence presentation, independent review workflow, notice, appeal, correction, finite sourced labels, subject export and aggregate transparency. It is not an asset controller, punishment engine, custody service or AI judge.

Native YNXT freeze, seizure, blacklist, confiscation or transfer requests are rejected. Actual product or chain actions remain owned by their canonical product, Chain Core and Governance boundaries.

## Canonical dependencies

| Owner | Dependency | Required state |
|---|---|---|
| 02 Wallet/Auth | Product-scoped session, exact device binding, exact scopes, expiry and revoke | Accepted contract and shared-Testnet registration |
| 14 AI | Explanation-only provider route with explicit consent and no mutation tools | Provider-backed evidence, optional for core due process |
| 26 Data Fabric | Canonical Trust events and billing-neutral audit ingestion | Contract acceptance |
| 28 Website | `/trust-center` route, public metadata, support/privacy/security/status links | Publish only after release gates |
| 29 Integration | Canonical Gateway registration, route mapping and shared-Testnet vectors | Required before `integratedCentral=true` |
| 30 Security/SRE | Encrypted remote custody, independent restore, artifact provenance and deployment controls | Required before public release |
| 31 Governance | Authoritative request/review/appeal/transparency state | Required for shared-Testnet authority |
| Legal/Privacy | Retention, deletion and mandatory audit-preservation policy | Required before destructive lifecycle implementation |

## Frozen machine-readable contract

- `release/integration/trust-center-contract.json`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`

The contract freezes the client ID, session/device headers, exact least-privilege scopes, central route mapping, subject-export boundary, canonical event candidates, fail-closed error semantics, state format v2, backup schema and truthful release states.

## Exact Wallet scope enforcement

Runtime commit `f042dd5b20833497333477bd99cf9d7542eceb38` enforces required Trust scopes on product-local and authoritative proxy routes.

- wildcard, duplicate, blank, whitespace-mutated and unknown scopes are rejected;
- wrong product, wrong device, expiry and revoke remain fail closed;
- read-only and write-only sessions cannot cross route boundaries;
- `GET /api/export` requires exactly `trust:evidence:read`.

Central integration must not widen these scopes or introduce a compatibility wildcard.

## Subject export

Runtime commit `77ad082036a866c9730f8ca3694d977fa56cc171` adds `GET /api/export` with schema `ynx-trust-subject-export/v1`.

The export includes only cases owned by or concerning the authenticated account plus that account's AI and relevant audit records. It omits other subjects, central session bindings, token hashes, replay internals and persistence seals. The response is `no-store` and attachment-scoped. Deletion and retention remain policy-gated and are not claimed complete.

## Persistence and recovery

Runtime commit `d31811280ba741026c74a836a212f78fe88c172a` adds schema `ynx-trust-backup/v1` and `ynx-trust-backup create|restore`.

Create:

- reads an admitted version-2 Trust state;
- emits manifest state SHA-256, exact byte count, record counts and sequence;
- seals the backup envelope;
- creates a new mode-`0600` regular file in a private directory;
- never stores plaintext Wallet session tokens and never overwrites an existing path.

Restore:

- rejects non-regular, symlinked or non-`0600` backup sources;
- verifies schema/product identity, manifest hash/bytes/counts, envelope seal, nested state seal and persisted Wallet bindings;
- creates only a new mode-`0600` store and never overwrites;
- requires a successful independent cold start.

The local SHA-256 seals prove byte consistency. They are not external signatures, encryption, remote custody, hardware attestation or independent audit.

## Verification at this checkpoint

Passed:

```text
go test -race ./internal/trustproduct ./cmd/ynx-trust-backup
go vet ./internal/trustproduct ./cmd/ynx-trust-backup ./apps/trust-center
go test ./internal/trustgateway ./internal/trustproduct ./apps/trust-center ./cmd/ynx-trust-backup
./apps/trust-center/check.sh
```

Repository-wide `go test ./...` remains red outside the Trust slice because generated Solidity devtool artifacts are absent and two unrelated permission fixtures fail on the host filesystem behavior. Trust packages and the new CLI pass; the repository preflight is not represented as green.

## GitHub evidence truth

At the source-bound preview checkpoint:

- final branch exists and tracks `origin/codex/final-trust-center`;
- local and remote SHA matched `1baeccada8e72eab8277803973d0e598dcf19b51` when the artifact was produced;
- GitHub Actions run `30416831778` passed the Trust release workflow;
- workflow artifact `8710457317` was uploaded with digest `sha256:c01af21b81c56e3c3687c039fd568a46fd28e9b782465aa5ee2645ba17972a7c`;
- GitHub prerelease `trust-center-v0.1.0-testnet-preview.1` hosts the unsigned archive, SBOM, provenance, verification, checksums and notices;
- archive SHA-256 is `92805078f0a8daebc1e329a293e625d161b600c70371d4cfb7a2ed57e47d1850` for 4,526,557 bytes.

Therefore `installedLocal` and `downloadHosted` are true. Central integration, staging/public deployment, production signing and store release remain false.

## Required Integration actions

1. Freeze `ynx-trust-center-v1` in the canonical product registry.
2. Approve only the exact scopes in the contract; no wildcard or implicit widening.
3. Route the frozen `/app/trust/**` and `/app/governance/**` paths to canonical owners.
4. Execute every vector in `CROSS_PRODUCT_TEST_VECTORS.json`, including export isolation and recovery vectors.
5. Preserve explicit 503 fail-closed behavior when any authority dependency is unavailable.
6. Return exact source/deployed commits, request/error/audit IDs, health/version output and rollback evidence.
7. Keep all release-state booleans evidence-backed and independent.

## Current release truth

- `implementedLocal`: true
- `testedLocal`: true
- `installedLocal`: true
- `integratedCentral`: false
- `deployedStaging`: false
- `deployedPublic`: false
- `downloadHosted`: true
- `productionSigned`: false
- `storeReleased`: false
