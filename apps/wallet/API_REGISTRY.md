# External API registry

| Interface | Authority | Authentication | Rate/health behavior | Data/retention boundary | Status |
|---|---|---|---|---|---|
| YNX Testnet account/activity/broadcast | YNX chain state | Public read; signed transaction write | Client timeout, explicit unavailable state; no synthetic fallback | Public chain data; signed payload only | Existing client, public RPC evidence only |
| Canonical App Gateway | YNX identity/session authority | P-256 device proof and Product Session | Fail closed on timeout, expiry, replay or revoke | Bound request/session/audit fields; no seed/private key | Candidate, not centrally deployed |
| ERC-7769 Bundler RPC | Third-party/YNX Testnet execution relay | Provider policy plus signed UserOperation | Simulate first; expose provider error/rate limit | UserOperation and receipt only | Adapter schema implemented; endpoint input required |
| Paymaster | Sponsor budget authority | Product Session, operation digest, anti-Sybil binding | Disabled/outage/budget exhaustion returns ineligible; never changes operation | Minimal account binding and budget counters | Policy evaluator implemented; deployment required |
| WalletConnect | External compatibility | WalletConnect session namespaces | Disconnect and expire fail closed | External dApp metadata/requests; never YNX seed | Not integrated |
| Credential issuer/status | Third-party claim authority | Issuer-specific official flow | Expiry/revocation/status outage fails closed | Eligibility result only; no copied identity document | Candidate parser implemented; issuer approval required |
| OIDC/OAuth provider | Third-party authentication | Authorization Code + PKCE; DPoP where supported | Exact redirect, issuer and nonce checks | Provider claims only; never YNX account authority | Reference boundary only |

Official specifications, licensing/terms and version links are tracked in `REFERENCE.md` and `THIRD_PARTY_NOTICES.md`. Operator credentials are never accepted in chat and are requested only through the secure operator-input workflow.
