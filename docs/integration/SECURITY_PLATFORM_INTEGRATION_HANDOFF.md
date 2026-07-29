# Security Platform Integration Handoff

## Authority

Owner: `30-security-sre-release`

Source commit: `900c314ddb8f6f56b8713e7df194f26ee0590e06`

Contract: `release/integration/security-platform-contract.json`

This platform owns the security framework, enforcement tools, release evidence, artifact verification policy, backup/restore controls, CI/CD gates, monitoring integration contract, and incident-response contract. It does not own user assets, business execution, treasury, governance, mint/burn, bridge transfer, payment execution, or any product owner's signing authority.

## Current acceptance state

- Local implementation: accepted by Product 30 tests.
- Local tests: accepted; security suite and repository suite pass.
- Remote validation: passed in `JiahaoAlbus/YNX-Chain` at `7be79d5b921e2b044fff43d5eb3f10fcad2eac11`; the earlier `aa5d5e9` CI evidence belongs to the legacy repository and remains historical only.
- Branch controls: the authoritative branch workflow is validation-only and all external Actions are pinned to immutable commit SHAs; repository protection is still pending.
- Local encrypted restore drill: passed for the committed `security-platform/` metadata set.
- Local reproducible artifact drill: passed for source commit `900c314ddb8f6f56b8713e7df194f26ee0590e06`, including SBOM, provenance, test signature, tamper rejection, wrong-identity rejection, and unsigned-public rejection.
- Clean installation: passed from a fresh authoritative-repository clone detached at exact candidate source `900c314ddb8f6f56b8713e7df194f26ee0590e06`; locked install, lifecycle audit, dependency rebuild, CLI verification, notices, manifest render, production dependency audit, and 172/172 tests passed.
- Artifact distribution: not hosted; the active artifact remains local/test-signed and is not public-release eligible.
- Central integration: not accepted.
- Staging deployment: not evidenced.
- Public deployment: not evidenced.
- Production signing: not evidenced.
- External input boundary: `release/security-platform/operator-inputs.request.json` records the minimum metadata and approvals still required without requesting value material.

## Product-owner inputs

Each product owner must provide a handoff containing:

- product and service identity;
- environment and trust-domain binding;
- allowed audiences and scopes;
- certificate subject/SAN requirements;
- sensitive-material classes and named owners;
- artifact classes and release targets;
- health/version dependency truth;
- backup data sets, consistency rules, and recovery boundary;
- incident types, pause authority, communication owner, and recovery owner;
- test vectors and expected fail-closed errors.

Do not send value material, signing material, recovery material, or full authentication tokens in the handoff.

## Central owners

- `01-chain-core`: validator/deploy/chain-state backup and rollback boundary.
- `02-wallet-auth`: product session, device, mandate, revoke, mobile signing boundary.
- `13-monitor`: SLO, alerts, synthetic checks, status and incident routing.
- `15-trust`: disclosure, appeal, correction and evidence handling.
- `18-docs-compliance`: public security claims and disclosure review.
- `19-oracle`: reporter identity, provider access metadata and incident contract.
- `21-bridge`: signer/MPC/HSM, pause and recovery boundary.
- `26-data-fabric`: audit, canonical event, ledger and integrity verification.
- `28-website`: hosted artifact, public status and SEO/crawler SRE targets.
- `29-integration`: unique release contract, merge order and shared Testnet proof.
- `31-governance`: security policy, timelock and emergency-control authority.

## Fail-closed defaults

Until accepted by the relevant owner:

- no cross-product allow policy is emitted;
- backup schedules remain suspended;
- deployment workflows remain validation-only;
- service identity is required but not asserted as installed;
- monitoring and sensitive-material manager manifests remain detached candidates;
- all public and production release states remain false.

## Verification

```bash
npm run security:verify
npm run security:test
npm run security:integration
npm test
npm run lint
```

Shared vectors: `docs/integration/SECURITY_PLATFORM_CROSS_PRODUCT_TEST_VECTORS.json`.
