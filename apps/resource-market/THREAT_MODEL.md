# Threat model

Local supply-chain gates use locked npm integrity records from the canonical npm registry, lifecycle scripts disabled during CI install, an explicit build-script allowlist, immutable GitHub Action commit pins, Go vet/race tests, `govulncheck`, npm audit, secret/filler scans, browser/DAST smoke, SBOM generation and artifact hashing. The minimum accepted builder is Go 1.25.12: the host default Go 1.25.7 was directly shown vulnerable and is excluded from release builds. Local evidence is recorded in `evidence/local-security-20260722.json`; no remote CI run or public provenance is claimed.

Protected assets are user authorization, provider identity, capacity evidence, signed meters, order state, receipts, dispute records, bond balances and audit continuity. The product never receives private keys, seed phrases or arbitrary withdrawal authority.

Trust boundaries: browser/native client → canonical Wallet/App Gateway → Resource Market API → provider worker/meter signer → settlement authority/indexer → persistence and observability. Third-party provider data is evidence, not YNX authority.

Primary threats and controls:

- Session replay, wrong product/device/bundle, scope widening, expiry or revoke: exact canonical Wallet claim validation and fail-closed session state.
- Capacity forgery and oversubscription: independent provider verification, evidence sources and atomic reservation accounting.
- Meter tamper or duplicate billing: provider-owned expiring Ed25519 worker keys, canonical payload preview, signature binding, revocation, bounded intervals/quantity, immutable IDs and receipt reconciliation.
- Quote/started-service presented as payment: explicit state machine; only authoritative receipt confirmation is settlement.
- Self-dealing and ranking manipulation: reviewer independence and auditable scoring inputs; production graph detection remains required.
- Unlimited slashing: penalty capped by available bond, notice, evidence, appeal window and independent appeal reviewer.
- Credential or personal-data leakage: bounded strict JSON, scoped views, security headers and body-free structured logs.
- Persistence tamper: exact schema, SHA-256 integrity envelope and fail-closed load. The checksum is not secret-key authenticity.
- AI acting on assets: explanation-only consent flow; no market mutation tool is available to AI.

Residual high risks before public deployment are no remote worker identity/signing ceremony, central integration not deployed, public infrastructure not penetration-tested, no durable trace/metric backend, no production settlement signer ceremony and no external legal/insurance review.
