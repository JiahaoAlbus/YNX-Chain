# YNXT Economics Integration Handoff

## Authority and source

- Contract: `release/integration/ynxt-economics-contract.json`
- Cross-product vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- Source commit: `cca294f36e84e1c63b3722d705172bed1ad17bd5`
- Contract owner: 17 Economics
- Current phase: INTEGRATE
- Next gate: TESTNET
- Long-term goal status: Active

The contract freezes economic policy facts and integration boundaries. It does not activate consensus issuance, burn, slashing, Treasury execution, liquid staking, stablecoin custody, or any public deployment.

## Owner handoffs

| Owner | Required acceptance | Evidence supplied | Activation remains false until |
| --- | --- | --- | --- |
| 01 Chain Core | Accept runtime state/event schemas, migration and rollback; bind chain execution to accepted governance state | Runtime replay vector, supply/fee invariants, staking slash/recovery vector | migration, rollback and shared-Testnet receipts exist |
| 02 Wallet/Auth | Freeze product/session tuple and explicit review semantics for staking and capital actions | risk fields, signed-intent domains, no-guaranteed-APY boundary | accepted scopes, device/session/revoke tests exist |
| 07 Exchange | Map fee, funding, insurance and solvency fields without double-counting burn | fee/burn/revenue separation vector | Exchange owner accepts ledger mapping |
| 08 Quant | Preserve realized-net high-water-mark ownership and explicit user approval | existing Quant handoff and contract boundary | owning implementation and cross-product vector are accepted |
| 19 Oracle | Supply price, reserve-ratio and depeg reference facts with source/asOf/version/failure | stable-settlement boundary and failure semantics | accepted provider contract and outage tests exist |
| 21 Bridge | Supply cross-chain exposure and asset-state facts | bridge exposure dependency declaration | accepted contracts and failure vectors exist |
| 26 Data Fabric | Accept canonical event names, versions, audit hashes and billing classes | deterministic vectors for epoch, slash, recovery and fee separation | event ingestion and ledger reconciliation pass |
| 12 Explorer | Render source, asOf, version, coverage, burn/revenue separation and candidate status | local public API/UI and event vectors | accepted projection consumes shared-Testnet events |
| 13 Monitor | Alert on supply/fee reconciliation, signature/timelock failure and state tampering | explicit monitor assertions in vectors | accepted alerts are exercised on shared Testnet |
| 31 Governance | Freeze proposal, threshold, timelock and parameter-change rules | policy hashes, action hashes and signature vectors | accepted proposal/timelock contracts execute successfully |
| 29 Integration | Freeze the single contract and coordinate merge/test order | contract, dependency acceptance and vectors | all mandatory owners accept the same version |
| 28 Website | Publish only evidence-backed release state and risk disclosures | `/ynxt`, `/economics`, metadata and release booleans | domain, SSR/SSG and public evidence exist |

## Canonical event acceptance

Consumers must accept exactly these versioned names for this contract version:

- `ynx.economics.epoch_settled.v1`
- `ynx.economics.policy_change_scheduled.v1`
- `ynx.economics.policy_change_activated.v1`
- `ynx.staking.validator_slashed.v1`
- `ynx.staking.validator_unjailed.v1`

A consumer must reject an unsupported version, missing audit hash, non-sequential state, fee/supply mismatch, or changed event meaning. Compatibility aliases may be temporary migration inputs only; they may not become parallel authorities.

## Mandatory accounting semantics

1. `grossFee = baseFeeBurn + serviceBurn + validator + provider + protocol + treasury`.
2. Burn is supply destruction and is never Revenue.
3. Test subsidies, internal transfers and unrealized fees are not Revenue.
4. Issuance can enter only Network Security, Public Goods, governance-approved Grants, and capped Adoption Incentives.
5. Slashing reconciles operator, delegated and queued-unbonding exposure; governance authorization binds the canonical action hash.
6. Performance fee belongs to the Quant owner and may use only realized net profit above the high-water mark after explicit costs and user approval.
7. YUSD remains a no-real-value sandbox until real reserve, custodian, attestation, redemption rail, legal review and deployment evidence exist.

## Required verification

```text
make economics-integration-contract-check
make economics-integration-adapter-check
make staking-risk-runtime-check
make economics-local-candidate-check
go test ./...
```

The first accepted central integration must additionally execute the vectors in `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json` against the shared Testnet and attach block, transaction, receipt, API, Explorer and Monitor evidence to the exact source commit.

## Prohibited merge shortcuts

- Do not infer `integratedCentral`, `deployedStaging`, `deployedPublic`, `productionSigned`, or `storeReleased` from local tests.
- Do not activate candidate fee burn, issuance, slashing, Treasury or stable settlement using a local administrator flag.
- Do not create a second economic policy, event schema, error-code set or fee split in another product.
- Do not substitute static success responses for unavailable owners or providers.
- Do not place signer material, private keys, seed phrases, PEM files, validator keys or complete provider secrets in this handoff.
