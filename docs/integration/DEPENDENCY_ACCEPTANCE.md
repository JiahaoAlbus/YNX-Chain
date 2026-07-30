# Oracle Dependency Acceptance

**Frozen Oracle source commit:** `7ba44cfbe66455884ac6c2ea8525e9738b7f1396`

No dependency below is accepted merely because an adapter, schema, or handoff file exists. Acceptance requires direct consumer-owner evidence against the exact source commit.

| Owner | Required acceptance | Current state | Evidence required to change state |
|---|---|---|---|
| 01 Chain Core | Deterministic Oracle system record or precompile contract; no HTTP in consensus | Central source accepted; Oracle consumer pending | Product 01 central receipt accepts `324f376dac2db434673ccec2c6d212ed3d23f79e`; Oracle still requires state-transition vectors, schema/version rejection tests, upgrade/rollback height and committed-event evidence |
| 02 Wallet/Auth | Canonical Product Session policy only where protected Oracle routes require it | Central source accepted; route policy pending | Product 02 central receipt accepts `f28b0aa29a0d93a2b7f20a00b835c4a1aa6175b3`; Oracle still requires scope, expiry/revoke, wrong-product and wrong-device evidence if a protected route is assigned |
| 07 Exchange | Index, mark, funding, and liquidation-safe failure integration | Pending | Consumer test-vector run, funding spike, stale source, venue exclusion, and liquidation breaker drills |
| 08 Quant | Historical and live feed separation with lineage | Pending | Live/history parity result, raw venue data preservation, stale/replay rejection |
| 09 DEX | Confirmed pool-state and manipulation-resistant TWAP contract | Pending | Reorg, multi-block confirmation, low-liquidity, flash-loan, and replay vectors |
| 12 Explorer | Public provider, price, lineage, and correction display | Pending | Public response URL, exact source commit, correction and lineage rendering evidence |
| 13 Monitor | Stale, divergence, outage, manipulation, pause, and recovery alerts | Pending | Alert delivery timestamp, recovery timestamp, deduplication and escalation evidence |
| 15 Trust | Provider removal appeal and data-correction process | Pending | Notice, appeal, reviewer identity, correction audit trail, resolution evidence |
| 17 Economics | Stablecoin price, reserve-evidence ratio, depeg, treasury and solvency boundaries | Pending | Provider/custodian semantics, unverified-state rejection, legal/audit review status |
| 21 Bridge | Valuation and route-risk input only; never release proof | Pending | Stale and source-limitation halt vectors, route-risk acceptance, release-authority separation review |
| 26 Data Fabric | Canonical event, retention, export, and billing boundary | Central source accepted; Oracle event acceptance pending | Product 26 central receipt accepts `2a09d7455a5fef9eee56ca736be4b600d40a1831`; Oracle still requires event-schema, replay, retention-rights, export and deletion evidence |
| 30 Security/SRE | Signer custody, secrets, release, backup, restore and incident controls | Central source accepted; Oracle operations acceptance pending | Product 30 central receipt accepts `e670749b83a1b40d09ed717eb3515d539c005c49`; Oracle still requires signer-custody, backup/restore, incident and emergency-pause acceptance |
| 31 Governance | Provider, threshold, clamp, window, timelock and rollback control | Pending | Proposal schema, timelock test, simulation, rollback and emergency-control evidence |
| 29 Integration | Single protocol freeze, merge order, shared Testnet and public proof | Pending | Conflict resolution, contract hash, cross-product vector results and shared Testnet evidence |
| 28 Website | Public `/oracle` status and documentation | Pending | Public unauthenticated URL, source commit, health/version/price evidence and SEO handoff acceptance |

## Fail-closed rule

Until an owner returns the required evidence, the dependency remains pending and `integratedCentral` stays false. No mock production endpoint, static success response, inferred acceptance, or private owner-only page may satisfy this gate.

## External inputs

Provider credentials, redistribution rights, reporter signer custody, public deployment authority, DNS, stablecoin attestation access, Testnet funding, and legal/compliance approval must be delivered through secure operator workflows. Secrets and private keys must never be pasted into chat or committed to this repository.
