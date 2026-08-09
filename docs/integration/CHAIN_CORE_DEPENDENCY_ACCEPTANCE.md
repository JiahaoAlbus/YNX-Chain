# Chain Core Dependency Acceptance

| Dependency | Owner | Required input | Current state | Fail-closed behavior |
| --- | --- | --- | --- | --- |
| Wallet/Auth | Wallet/Auth | Accepted product registry, request/approval digest, ordered scopes, Product Session, introspection, expiry and revoke contract | Not accepted | Protected mutation forwarding remains disabled |
| App Gateway | App Gateway | Exact route-to-scope mapping and verified account/product/device context | Not accepted | No product-local compatibility login is added |
| Data Fabric | Data Fabric | Canonical event envelope, version and idempotency contract | Not accepted | Chain events remain chain-local evidence only |
| Oracle | Oracle | Source/as-of/version/confidence and outage contract | Not accepted | No external price fact is inferred by Chain Core |
| Bridge | Bridge | Asset lifecycle and finality contract | Not accepted | No cross-chain mint, burn or release is enabled |
| Security/SRE | Security/SRE | Artifact, signer, backup and public release acceptance | Public cutover acceptance absent | Public BFT mutation and production signing remain disabled |
| Website | Website | Canonical public metadata and release-status consumption | Not accepted | Website must not infer current-source deployment |
| Integration | 29-integration | Unique contract freeze and cross-product vector result | Not accepted | `integratedCentral` remains false |

Acceptance requires an immutable source commit, contract version, exact schema and scope identifiers, passing positive and negative vectors, migration evidence and an explicit release-state update. A local adapter or successful unit test alone is insufficient.
