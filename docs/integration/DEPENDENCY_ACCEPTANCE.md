# YNX Shop dependency acceptance

Source commit: `4267fdbf3ff581043bafef5c357d915f1904b964`

| Dependency | Owner | Local adapter | Central/public acceptance | Required evidence |
|---|---|---:|---:|---|
| Wallet/Auth product session | 02 Wallet/Auth | Accepted locally | Not accepted | Registry merge, deployed Gateway version, positive session, replay/tamper/expiry/revoke vectors |
| Pay invoice/settlement/refund | 04 Pay | Accepted locally | Not accepted | Shop Testnet merchant/payout, committed payment and refund receipts, mismatch rejection |
| Trust dispute/appeal | 15 Trust Center | Accepted locally | Partially configured on old Staging | Authenticated case create/appeal/correction evidence from a Shop order |
| Data Fabric canonical events | 26 Data Fabric | Candidate envelope only | Not accepted | Event/schema version freeze and consumer acknowledgement |
| Explorer public proof | 12 Explorer | No current-source proof | Not accepted | Current order/payment/refund and release evidence indexed publicly |
| Monitor/SRE | 13 Monitor / 30 Security-SRE | Health/version exist | Current source not deployed | Current commit health/version, alerts, restart/restore, artifact provenance |
| Website/SEO | 28 Website | Metadata package available | Not accepted | Canonical micro-site, structured data, sitemap/indexing and truthful release status |
| Shared Testnet | 29 Integration | Local workflow tested | Blocked | Wallet + Pay + Trust dependencies accepted and a scheduled execution window |
| Android build host | Build environment | Source/static checks pass | Blocked | API 36 SDK, current APK build, install, cold start, restart, deep links |
| iOS build host | Build environment | Source/static checks pass | Blocked | Full Xcode, Simulator build/install/cold start/callback |
| Tax/address provider | Provider/legal owner | Honest unavailable state | Blocked | Approved sandbox, terms, jurisdiction, retention, adapter tests |
| Shipping/tracking provider | Provider/legal owner | Manual-unverified path only | Blocked | Approved sandbox, signed events, retry/reconciliation and failure tests |

## Acceptance rules

- No dependency is accepted from a document, HTTP 200 or static success page alone.
- Wallet and Pay failures remain fail closed; Shop does not create a local substitute for central authority.
- Provider credentials are referenced through approved operator configuration and never included in this repository or chat.
- Testnet, sandbox, simulator, preview signing and old Staging evidence remain distinct from production/public release.
- A dependency moves to accepted only when the exact contract version, source commit, tests and direct evidence are recorded in the coverage matrix and release record.
