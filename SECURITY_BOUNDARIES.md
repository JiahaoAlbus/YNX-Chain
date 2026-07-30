# Security Boundaries

This document defines the branch-local YNX Chain Core trust boundaries. It does not certify a public deployment or replace an independent security review.

## Authority boundaries

| Boundary | Authority held | Authority explicitly not held | Fail-closed evidence |
| --- | --- | --- | --- |
| CometBFT validators | Order blocks and commit the ABCI AppHash | User owner/session keys, service signer keys, custody credentials | Signed envelopes, deterministic execution, nonce checks, AppHash persistence |
| ABCI application | Validate and mutate native consensus state | Network ingress, DNS, external custody, exchange accounts | State-schema validation, migration hash, supply/lot reconciliation, atomic rejected transactions |
| BFT Gateway | Translate HTTP to Comet RPC and verify committed ABCI evidence | User-operation authority, arbitrary state writes, validator keys | Route/action matching, chain/hash/block/record verification, bounded responses |
| Bundler | Serialize its outer account nonce and submit an already user-signed operation | Smart Account owner authority or ability to alter signed calls | Independent inner signature, exact operation hash, committed Bundler/account evidence |
| Paymaster | Pay the fixed eligible operation fee from a locked budget | Call authority, owner change, withdrawal, scope widening | Product/call allowlist, account/global budget, expiry, optional attestation, lot reconciliation |
| Strategy engine | Execute actions inside an owner-approved mandate | Owner change, withdrawal, mandate widening, revoke bypass | Exact methods/assets/markets/limits/nonces, expiry, revoke and kill switch |
| Strategy Vault | Hold owner-attributed native YNXT lots | Engine or service withdrawal authority | Owner-only withdrawal and emergency exit, AppHash-bound audit |
| AI/service gateways | Propose or proxy bounded product actions | User private keys, autonomous payment/trading, governance or consensus upgrades | Scoped permissions, approval states, service signer isolation, audit records |
| Treasury observation | Read configured consensus buckets and run user-supplied stress models | Treasury transfer, secret market support, custody assertion | Transfer disabled, unconfigured buckets explicit, source/coverage/failure fields |
| Solvency API | Prove native consensus liabilities and supply conservation | Fiat/external reserve, price, liquidity or redemption claims | Exact category reconciliation, Merkle proof, external reserve ratio `null` |

## Key and credential boundaries

- Validator private keys and validator state belong only on the assigned validator host with mode-restricted paths. They are never accepted through an HTTP API or chat input.
- Native user and service actions use secp256k1 signed envelopes. Service private keys are process-local, loaded from restricted files, and must match the configured signer address.
- Smart Account owner/session signatures are independent of the Bundler signature. P-256 support is a cryptographic candidate; deployed WebAuthn RP/origin validation is absent.
- Bundler and gateway access keys are transport/operator controls, not asset authority. Provider credentials cannot substitute for a YNX identity or signature.
- Operator inputs must reference secure local paths. Private keys, seed phrases, PEM bodies, full API secrets, payment-card data, and validator keys must never be placed in release JSON or logs.

## Asset and accounting boundaries

- Native YNXT is conserved across liquid accounts, stake, queued unbonding, Strategy Vaults, and locked Paymaster budgets. Transfers move traceable lots with balances.
- YUSD is an isolated no-value sandbox. It is not a reserve attestation, custodian balance, redemption rail, or guaranteed peg.
- Liquid staking and Safety Module code are deterministic models only. They do not issue a token, move funds, guarantee yield, cover losses, or activate governance.
- External exchange, bridge, oracle, and custody systems remain third-party authority. Their responses cannot prove YNX consensus state or silently widen a mandate.

## Network and deployment boundaries

- The recovered public topology is one authoritative producer plus three authenticated read-only followers. It is not public four-validator BFT.
- StreamBFT remains shadow-only and cannot become default until every formal, differential, WAN, fault, recovery, soak, and rollback gate passes.
- Public ingress evidence from a transparent proxy, VPN fake-IP route, cache, or unauthenticated observer is ineligible as direct deployment proof.
- Cutover scripts require transaction-bound evidence, restricted backups, explicit approvals, mutation freeze, verification, and idempotent rollback. A plan or dry run is not a deployment.

## Open security evidence

Independent audit, current-source public deployment, SAST/DAST and container scan records, complete SBOM/license review, artifact provenance, four-validator Byzantine/fault evidence, public backup/restore, capacity/soak results, external custody review, and deployed WebAuthn validation remain open. These gaps keep production and public-release booleans false.
