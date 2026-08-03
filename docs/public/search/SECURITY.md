# YNX Security

| Field | Value |
| --- | --- |
| Version | 1.0.0-candidate |
| Effective date | 2026-07-22 |
| Evidence source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Canonical | `https://ynxweb4.com/security` |
| Title | YNX Security — Trust Boundaries, Supply Chain and Incident Readiness |
| Meta description | Review YNX security boundaries for keys, Wallet approvals, consensus, providers, artifacts, incidents and current audit limitations. |
| H1 | YNX Security |

## Direct answer

YNX security uses explicit authority boundaries, domain-separated signatures,
fail-closed validation, secret isolation, deterministic state, audit records,
backup/rollback procedures and truthful release states. No independent security
audit or zero-risk claim is established by these controls alone.

## Key boundaries

User seeds/private keys remain in approved Wallet custody. Validator, node,
overlay, provider and deployment credentials are separate and mode-restricted.
Only signed public transaction bytes cross the intended submission boundary.
AI, browser, frontend and documentation systems do not receive private keys.

## Wallet and Gateway

Product/device/account/scope/expiry binding, introspection and revocation are
required. Replay, tamper, wrong product/bundle/device, scope widening, expiry and
revocation fail closed.

## Supply chain

Final release requires threat model, security boundaries, SBOM, notices,
dependency and lockfile review, secret scan, SAST/DAST, container/artifact scans,
build allowlist, provenance and reproducibility. A current high-severity indirect
Hardhat development dependency advisory remains unresolved and must be mitigated
or accepted explicitly before a passing supply-chain claim.

## Artifacts and incidents

Public artifacts require immutable URL, SHA-256, bytes, signing class, minimum OS,
source and install/cold-start evidence. Incidents require identification,
containment, user impact, evidence preservation, recovery, communication,
correction and post-incident review. User errors must not expose stacks, secrets
or provider credentials.

## Current status

Local security gates and operational controls exist, but complete independent
audit, all scan classes, public status/support URLs and final artifact provenance
remain incomplete.

## Related pages

- [YNX Wallet](/wallet)
- [YNX Testnet Guide](/testnet)
- [YNX Trust](/trust)
- [YNX Developer](/developer)
- [FAQ](/faq)

## Change log

- 1.0.0-candidate (2026-07-22): Initial key, Wallet/Gateway, supply-chain,
  artifact, incident and status page.
