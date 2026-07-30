# Governance Dependency Acceptance

Source commit: `cd328bd5817f32efba259e0ad8948f202ebaf654`

| Dependency | Owner | Required evidence | Current state |
| --- | --- | --- | --- |
| Network identity and execution receipt | 01 Chain Core | signed intent inclusion, exact receipt, rollback and four-validator identity | local adapter tested; shared Testnet pending |
| Wallet identity and Product Session | 02 Wallet/Auth | exact product/device/scope/expiry/revoke vectors | manifest defined; central acceptance pending |
| Economics and parameter ownership | 17 Tokenomics | bounded fee, issuance, treasury and reserve parameters | registry bounds local; owner acceptance pending |
| Explorer | 12 Explorer | proposal and execution receipt indexing | pending |
| Monitor | 13 Monitor | timelock, canary, receipt and emergency alerts | pending |
| Trust | 15 Trust Center | correction, appeal and transparency linkage | local appeal adapter only |
| Canonical events | 26 Data Fabric | versioned event registration, ordering and replay behavior | pending |
| Integration | 29 Integration | conflict resolution and accepted source commit | pending |
| Security and signer custody | 30 Security/SRE | custody, artifact, restore and incident evidence | local candidate present; production acceptance pending |
| Public website | 28 Website | Governance-specific canonical route, title, H1, status, evidence, API, support and security destinations | HTTP 200 currently serves the generic root shell; product-page acceptance failed |

Governance remains fail-closed when any required identity, execution, event,
monitoring or custody dependency is unavailable. No dependent product state is
promoted by this document.
