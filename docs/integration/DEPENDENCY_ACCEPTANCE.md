# YNX 18 Dependency Acceptance

## Accepted inputs

| Dependency | Accepted evidence | Current boundary |
| --- | --- | --- |
| Website | `release/evidence/website-public-acceptance-2026-07-26.json` | Central integration, staging, public rendering and immutable unsigned candidate hosting are accepted for the named source and routes. |
| Public disclosure model | `release/facts`, `release/schemas` and `scripts/verify/public-disclosure-gate.mjs` | Local schema and evidence consistency are accepted. |
| Brand/network facts | `release/facts/brand.json`, `release/facts/network.json` | YNX Chain, YNX Web4, YNXT and YNX Testnet identities are accepted public candidate facts. |

## Pending owner acceptance

| Owner | Required input | Fail-closed behavior |
| --- | --- | --- |
| YNX 02 Wallet/Auth | Clean exact-commit contract, negative vectors and integrated evidence | Keep identity, mandate and revoke runtime claims Candidate or Blocked. |
| YNX 17 Economics | Clean exact-commit policy, tests and review state | Keep activated economics, APY, reserve, revenue and solvency claims unpromoted. |
| YNX 19 Oracle | Clean exact-commit data contract and source limitations | Do not publish a unique authoritative price or provider-coverage claim. |
| YNX 21 Bridge | Clean exact-commit lifecycle and proof evidence | Do not publish route availability, finality or asset-arrival claims. |
| YNX 26 Data Fabric | Frozen canonical event and billing schemas | Do not invent publication or billing events in this Worktree. |
| YNX 30 Security/SRE | Exact artifact, monitoring, backup and review evidence | Keep production signing, independent audit and full availability false. |
| YNX 29 Integration | Accepted conflict and migration decision | Do not support conflicting central protocols indefinitely. |

## External acceptance

Brand-media rights, named legal/economic/security review, production signing and
independent search/public proof remain external inputs. Their absence does not block
local disclosure engineering, but it does block stronger public release classes.

## Rejection rules

- Reject dirty, source-less, expired or ambiguous owner records.
- Reject screenshots, branch names or local tests as substitutes for stronger states.
- Reject Mainnet, production-signed, audited, fully compliant or guaranteed-outcome
  wording without exact matching evidence.
- Preserve the last accepted record and its supersession chain when a dependency fails.
