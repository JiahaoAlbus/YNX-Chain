# Chain Core Integration Handoff

## Frozen chain-owned facts

- Network: `ynx_6423-1`; EVM compatibility ID: `6423` / `0x1917`; native asset: `YNXT`.
- Native user identity defaults to `ynx1...`; `0x...` is EVM compatibility only.
- Current committed-state schema is v11 with AppHash domain `YNX_ABCI_STATE_V11`; ABCI application version is 14 and State Sync snapshot format is 1.
- Chain Core owns final state, AppHash, transaction finality, chain-level events, native fee records and chain-level asset authorization primitives.
- Exact route classes and schema references are frozen in `release/integration/chain-core-contract.json`.

## Central dependencies

Wallet/Auth owns product registration, Device Challenge, Approval, Product Session, ordered scopes, expiry, introspection and revocation. App Gateway may forward a mutation only after the accepted Wallet/Auth contract proves the exact product, bundle, device, account, scopes and expiry. Chain Core will not create a parallel session protocol.

Data Fabric owns canonical cross-product event ingestion and billing ledger semantics. Oracle owns price and market facts. Bridge owns cross-chain lifecycle. Security/SRE owns release and artifact policy. Website owns public routes, downloads and SEO.

## Acceptance boundary

Source commit `05b7d3cd3ffc` contains locally tested v11 execution for native transfer, fixed fees, StrategyMandate, Strategy Vault, staking exit lifecycle, Smart Account, UserOperation, Paymaster, Treasury snapshot and native-liability solvency proofs. It also contains ABCI v14 State Sync snapshots with trusted AppHash binding and a local four-validator backup/restore/rollback replay drill. The BFT Gateway exposes committed EVM network, block, account, bounded pinned-contract bytecode/static calls/resource estimates, transaction, receipt and log reads, plus canonical signed YNXT transfer submission through `eth_sendRawTransaction`. The local Bundler now performs real nonce lookup, outer signing, Comet commit, receipt readback, Paymaster debit verification and replay rejection through ABCI/Gateway handlers. Strategy Vault funding fails closed after mandate expiry, revoke or kill and after vault closure, while owner-only withdrawal and emergency exit remain available; rejected mutations preserve fees, nonces, balances, lots and audit state. These capabilities are not deployed on the authoritative public runtime and are not centrally integrated with the accepted Wallet/Auth Product Session.

The deployed baseline remains `ynx-chain-02f4ccd8770c`, using one authoritative producer and three authenticated read-only followers. It is not four-validator CometBFT voting.

## Integration order

1. Freeze one accepted Wallet/Auth contract and exact scope identifiers in `29-integration`.
2. Bind the accepted Product Session introspection result to Chain Core mutation route classes.
3. Run every vector in `CROSS_PRODUCT_TEST_VECTORS.json`, including wrong product, scope widening, expiry, revoke and replay rejection.
4. Run v11 migration and AppHash determinism against four local CometBFT validators.
5. Only after local and remote gates pass, deploy follower-first with backup and rollback evidence.

No product may interpret this handoff as public deployment, production signing, Mainnet readiness or permission to execute a public BFT cutover.
