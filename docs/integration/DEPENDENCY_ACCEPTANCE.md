# YNX Video dependency acceptance

| Dependency owner | Required acceptance | Current status | Recovery condition |
|---|---|---|---|
| YNX 02 Wallet/Auth | Three exact registry entries; Product Session and Gateway v2 attestation | Pending | Central tests pass all wallet vectors without scope widening |
| YNX 04 Pay | Wallet-approved intent and authoritative paid settlement receipt | Pending | Matching receipt vector produces one allocation and unsettled vector produces none |
| YNX 14 AI | Bounded proposal/stream contract; no autonomous publish/remove/pay | Pending | Negative AI action vector is rejected and audited |
| YNX 15 Trust | Delegated per-user creator appeal | Pending | Local appeal remains pending without delegation; delegated vector is authoritative |
| YNX 26 Data Fabric | Versioned canonical Video events and billing ingestion | Pending | Owner accepts event schema and replay/idempotency vectors |
| YNX 29 Integration | Single frozen contract and shared-testnet execution | Pending | Contract and vectors are consumed with exact source commit |
| YNX 30 Security/SRE | Security, artifact, deployment and public evidence gate | Pending | Current-source artifacts and public probes pass owner gates |

No pending dependency permits a production mock, static success, raw bearer fallback, service-signed creator impersonation or synthetic revenue. Video remains fail closed while acceptance is absent.
