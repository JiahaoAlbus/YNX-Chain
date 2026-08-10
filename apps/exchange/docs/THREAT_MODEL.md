# YNX Exchange threat model

Scope: YNX-owned Testnet Spot engine, Pro/Mobile clients, canonical Gateway session, Wallet action authorization, indexer-observed deposits, reviewed withdrawals, Quant Adapter and persisted streams.

## Assets and trust boundaries

- User Wallet key/seed: remains in Wallet; Exchange receives public key and action signature only.
- Exchange subaccount balances/reservations, orders, fills, fees and audit/event chains: authoritative persisted Exchange state.
- Gateway session: externally authoritative identity/scope/device/product decision; Exchange fails closed when configured authorization fails.
- Indexer evidence: authoritative only for its committed transfer/confirmation scope; it cannot create Wallet identity or Exchange balances outside deposit rules.
- Admin Testnet credit and withdrawal review: privileged operator boundaries; neither is production custody or broadcast proof.
- Quant mandate: bounded to subaccount, market, methods, capital, 1x leverage, expiry and nonce domain; never a withdrawal or ownership credential.

## Principal threats and controls

| Threat | Current controls | Residual gap |
|---|---|---|
| Stolen/replayed order authorization | Exact Wallet-bound payload, idempotency digest, account/public-key verification | Central revocation/public integration evidence pending |
| Scope/product/device widening | Gateway introspection and exact local scopes fail closed | Registry acceptance and remote wrong-product/device vectors pending |
| Private-key extraction | Runtime never requests or stores seed/private key; Quant forbidden capabilities | Independent client/runtime audit pending |
| Balance double spend/race | Single service mutex, upfront reserve, fixed-point ledger, race tests, rollback on save error | Multi-node consensus/transactional store absent |
| Self-trade/wash volume | STP rejects crossing same-account orders; public tape uses actual matches | Linked-account surveillance and abuse response absent |
| Spoofing/layering/fake depth | No synthetic depth; Wallet-authorized orders | Surveillance, cancel-quality and maker-integrity scoring absent |
| Trigger manipulation | Stop/TP/Trailing use persisted actual YNX matches only | Thin-market manipulation controls/oracle bands absent |
| Persistence tamper/rollback | Whole-state SHA-256, audit and execution hash chains, startup/readiness rejection | Anti-rollback external checkpoint/HSM and append store absent |
| WebSocket data leakage | User/drop-copy Gateway auth and account filtering; same-origin; query tokens rejected | Load/slow-consumer bounds and external penetration test absent |
| Request smuggling/resource exhaustion | Go server header/read/write/idle limits, 64 KiB strict JSON body limit, WebSocket buffers, bounded direct-peer rate state and 128-slot concurrency gate | Distributed ingress limits, per-route budgets and deployment tuning pending |
| Operator/admin abuse | Admin key limited to Testnet credits; withdrawal stops before broadcast; audit | RBAC, dual control, secret manager and remote operator evidence absent |
| Quant privilege escalation | Signed bounded mandate plus per-action signature; forbidden method manifest | Margin/perp leverage/risk methods not implemented |
| Dependency/build compromise | Lockfiles and SBOMs present | Final SAST/DAST/container/artifact scan and provenance pending |

## Abuse cases that must remain impossible

Withdraw, owner change, withdrawal-address mutation, unapproved transfer, risk override or API-key export through Quant; AI signing/execution; fake price/liquidity/volume; accepting invalid/tampered state; releasing more reserve than held; charging hidden spread or unrealized-profit fees.

## Security gates before public deployment

Add distributed/per-route ingress limits, traces and richer metrics, external anti-rollback checkpoints, transactional persistence, secret-manager/dual-control operations, DAST/fuzz/load tests, dependency/license review, artifact provenance/reproducibility, external review, central Gateway proof and remote incident/restore exercise. Margin, liquidation, cross-chain and custody require separate threat-model extensions before activation.
