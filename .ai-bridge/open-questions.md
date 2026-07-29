# YNX Creator Studio — Open Questions and External Inputs

Status: ACTIVE
Updated: 2026-07-29T02:33:33Z

These are integration decisions or external owner inputs. They do not block independent Creator Studio engineering.

| ID | Owner | Required input / acceptance | Recovery condition | Current handling |
|---|---|---|---|---|
| CS-EXT-01 | YNX 02 Wallet/Auth | Accept Creator Studio product tuple, scopes, callback and device/session introspection contract. | Central registry and negative vectors pass on shared Testnet. | Local gateway verifier remains fail closed; `integratedCentral=false`. |
| CS-EXT-02 | YNX 04 Pay + YNX 26 Data Fabric | Provide authoritative Testnet receipt, revenue, refund, dispute and billing-event contracts. | Shared event/receipt vectors reconcile without duplicate allocation. | Local adapters verify injected interfaces; no real-value revenue is claimed. |
| CS-EXT-03 | YNX 15 Trust Center | Accept rights/takedown/appeal case delegation and canonical status events. | Trust case IDs and negative vectors are acknowledged. | Local moderation remains explicit; no delegated acceptance claimed. |
| CS-EXT-04 | YNX 13 Monitor + YNX 12 Explorer | Accept health/version/audit evidence and shared request identifiers. | Shared dashboards/public evidence resolve to the current source commit. | Local health/version/audit only. |
| CS-EXT-05 | YNX 29 Integration | Freeze the unique cross-product schema/event/error versions and merge order. | Dependency acceptance file is signed off with a central commit. | Creator contract remains a candidate. |
| CS-EXT-06 | YNX 30 Security/SRE | Validate scanner, backup, artifact, SBOM/provenance and release policy. | Security/SRE evidence identifies current source and artifact hashes. | Local scanner process smoke remains fail closed because local ClamAV config/database are unavailable. |
| CS-EXT-07 | YNX 28 Website | Consume `/creator-studio` metadata and deploy the public product page on `ynxweb4.com`. | Public page, canonical URL, structured data and source-bound deployment evidence exist. | `websitePublished=false`; runtime and website states remain separate. |
| CS-EXT-08 | Founder/operator | Supply approved public Support, Privacy, Security and Status URLs, plus production deployment/signing access when ready. | Minimal operator input request is fulfilled outside chat-secret channels. | No placeholder or invented URLs are published. |

## Not yet escalated as operator requests

No private key, seed, provider secret, signing material or production credential is requested. The product still has autonomous content-lifecycle, observability, security, capacity, artifact and Testnet-adapter work remaining.

No external acceptance has been inferred from branch-local code, a candidate contract, a Website handoff, an HTTP 200 response or another product owner's documentation.
