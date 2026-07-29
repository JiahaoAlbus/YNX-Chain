# YNX Video dependency acceptance

Product contract: `ynx-video-integration-v2`  
Product source commit: `cbf35c029acb14011f4bb25e7b230e4d1fbbbd8e`

| Dependency owner | Required acceptance | Current status | Recovery condition |
|---|---|---|---|
| YNX 02 Wallet/Auth | Three exact registry entries; Product Session and Gateway v2 attestation | Pending | Central tests pass all wallet vectors without scope widening |
| YNX 04 Pay | Wallet-approved intent and authoritative paid settlement receipt | Pending | Matching receipt vector produces one allocation and unsettled vector produces none |
| YNX 14 AI | Bounded proposal/stream contract; no autonomous publish/remove/pay | Pending | Negative AI action vector is rejected and audited |
| YNX 15 Trust | Delegated per-user creator appeal | Pending | Local appeal remains pending without delegation; delegated vector is authoritative |
| YNX 26 Data Fabric | Versioned canonical Video events, media-integrity lineage and billing ingestion | Pending | Owner accepts event schema plus replay/idempotency and media-lineage vectors |
| YNX 29 Integration | Single frozen v2 contract and shared-testnet execution | Pending | Contract and vectors are consumed with the exact source commit above |
| YNX 30 Security/SRE | Security, artifact, deployment and public evidence gate | Pending | Current-source artifacts, SBOM/provenance and public probes pass owner gates |

## Product-owned acceptance already proven locally

- Upload digest is caller-declared and verified in constant time.
- HLS playlist, each HLS segment and original fallback persist byte count, SHA-256 and lineage.
- Schema v2 backfills legacy media metadata; missing legacy assets fail closed to private/failed.
- Video unit, race and vet gates passed, together with Viewer check and smoke.

No pending dependency permits a production mock, static success, raw bearer fallback, service-signed creator impersonation, unverified media derivative or synthetic revenue. Video remains fail closed while acceptance is absent.
