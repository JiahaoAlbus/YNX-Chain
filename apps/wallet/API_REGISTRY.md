# External API registry

| Interface | Authority | Authentication | Rate/health behavior | Data/retention boundary | Status |
|---|---|---|---|---|---|
| YNX Testnet account/activity/broadcast | YNX chain state | Public read; signed transaction write | Client timeout, explicit unavailable state; no synthetic fallback | Public chain data; signed payload only | Existing client, public RPC evidence only |
| Canonical App Gateway | YNX identity/session authority | Wallet approval, P-256 completion and sender-constrained per-request Product Session proof | Fail closed on timeout, expiry, HTTP binding mismatch, replay or revoke | Bound request/session/audit fields; no seed/private key | Adapter, manifest, state schema and vector implemented; not centrally merged/deployed |
| ERC-7769 Bundler RPC | Third-party/YNX Testnet execution relay | Provider policy plus already-signed UserOperation; optional in-memory auth header | Strict chain/EntryPoint health, timeout, response-size and local rate limit; provider errors fail closed | Packed UserOperation and receipt only; source/asOf/version attached | Strict adapter and isolated fixture tests implemented; official YNX endpoint input and public receipt required |
| Paymaster | Sponsor budget authority | EIP-712 policy signer bound to operation core, product, subject, policy, target, validity and authorization ID | Disabled/outage/replay/budget exhaustion returns failure; Risk Officer can only tighten | Product/subject conservative max-cost reservations and observed postOp cost; no identity documents | Contract and real local EntryPoint sponsored operations implemented; deployment/funding/external audit required |
| WalletConnect | External compatibility | WalletConnect session namespaces | Disconnect and expire fail closed | External dApp metadata/requests; never YNX seed | Not integrated |
| Credential issuer/status | Third-party claim authority | Issuer-specific official flow | Expiry/revocation/status outage fails closed | Eligibility result only; no copied identity document | Candidate parser implemented; issuer approval required |
| OIDC/OAuth provider | Third-party authentication | Authorization Code + PKCE; DPoP where supported | Exact redirect, issuer and nonce checks | Provider claims only; never YNX account authority | Reference boundary only |

Official specifications, licensing/terms and version links are tracked in `REFERENCE.md` and `THIRD_PARTY_NOTICES.md`. Operator credentials are never accepted in chat and are requested only through the secure operator-input workflow.

Public probe note (2026-07-22): the EVM endpoint returned `eth_chainId=0x1917` and `eth_blockNumber=0x6bf29`, but `eth_getCode` returned `-32601`. Public EntryPoint and ERC-4337 compatibility therefore remain unverified; see the Chain Core integration handoff.
