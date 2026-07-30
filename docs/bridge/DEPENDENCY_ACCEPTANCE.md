# YNX Bridge Dependency Acceptance

No central dependency is accepted in this worktree yet. Each item remains fail closed until the named owner returns a versioned acceptance artifact and the shared Integration owner freezes the compatible version.

| Owner | Required input | Current state | Acceptance evidence required |
| --- | --- | --- | --- |
| 01 Chain Core | Source/destination finality, confirmation, reorg, and canonical event evidence | Not accepted | Versioned API/event schema, test vectors, reorg vectors, source commit |
| 02 Wallet/Auth | Product Session, Wallet review tuple, signed intent, expiry, nonce, revoke | Not accepted | Signed-intent vectors, scope matrix, replay/tamper tests, source commit |
| 04 Pay | Post-bridge payment and refund gate | Not accepted | Test proving payment remains pending until `destination_available` and explicit flag |
| 07 Exchange | Deposit credit and withdrawal lifecycle | Not accepted | Test proving no credit at destination confirmation alone |
| 09 DEX | External route and destination availability | Not accepted | Route labeling, slippage/finality disclosure, availability gate vectors |
| 12 Explorer | Source/proof/destination/availability evidence | Not accepted | Deep-link schema and evidence rendering vectors |
| 13 Monitor | Provider, exposure, failure, reconciliation, limits, pause, incident | Not accepted | Metrics/alerts contract and stale/pause/provider-failure vectors |
| 15 Trust | Dispute, evidence, appeal, correction | Not accepted | Case schema, immutable evidence references, correction vectors |
| 17 Economics | Stablecoin, reserve, exposure, solvency | Not accepted | Reconciliation and liability schema, no-double-count test |
| 19 Oracle | Asset valuation and route risk | Not accepted | Versioned valuation/risk contract with source/asOf/confidence/stale semantics |
| 26 Data Fabric | Canonical events, Saga, billing ledger | Not accepted | Event envelope, idempotency, ordering, replay, correction vectors |
| 30 Security/SRE | Secret, signer, release, backup, incident | Not accepted | Signer boundary review, backup/restore drill, artifact provenance, incident contract |
| 31 Governance | Provider, limits, pause, contracts, timelock | Not accepted | Proposal/control schema, timelock tests, emergency boundary |
| 29 Integration | Unique protocol freeze and shared Testnet | Not accepted | Accepted contract version, merge order, shared Testnet evidence |
| 28 Website | `/bridge` docs, status, public evidence | Not accepted | Public URL, content review, evidence links, no-internal-value scan |

## Acceptance rule

A dependency may change to accepted only when its evidence is bound to a source commit and directly passes the cross-product vectors in `docs/bridge/CROSS_PRODUCT_TEST_VECTORS.json`. A provider webhook, manual operator assertion, static page, or mock response is not acceptance evidence.
