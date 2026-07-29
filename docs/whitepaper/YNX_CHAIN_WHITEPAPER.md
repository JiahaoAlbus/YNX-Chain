# YNX Chain Technical Whitepaper

| Metadata | Value |
| --- | --- |
| Version | 0.2.0-candidate |
| Effective date | 2026-07-22 |
| Source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | Initial three-paragraph repository summary |
| Review status | Technical draft; independent security, economic, and legal review required |

## Direct answer

YNX Chain is a Web4 Layer-1 ecosystem under active Testnet engineering. YNX Web4
is the application ecosystem powered by YNX Chain. YNXT is the native Testnet
asset. YNX Testnet uses EVM Chain ID `6423` (`0x1917`) and Comet/Cosmos chain ID
`ynx_6423-1`.

In this document, “Web4” describes the project’s intended combination of
user-controlled accounts, permissioned applications, verifiable execution,
evidence-linked automation, and explicit human approval. It is a YNX product
term, not a claim that a new Internet standard has been adopted.

YNX is not affiliated with unrelated Lynx-branded products.

## Status and reading rules

This is a Testnet technical disclosure, not a Mainnet launch statement, token
sale document, investment prospectus, audit report, reserve attestation, or
regulatory approval. The current source contains locally tested components,
deployment tooling, operator-controlled remote evidence, and product candidates.
Those evidence classes are not interchangeable.

The following release states must be evaluated separately for every component:

| State | Meaning |
| --- | --- |
| `implementedLocal` | The claimed behavior exists in source on the identified commit. |
| `testedLocal` | A directly relevant local test passed on that source. |
| `installedLocal` | The claimed package was installed and cold-started on the stated target. |
| `integratedCentral` | The accepted component is incorporated into the central release line. |
| `deployedStaging` | A staging deployment is directly evidenced. |
| `deployedPublic` | An independently reachable public deployment is directly evidenced. |
| `downloadHosted` | A downloadable artifact has an immutable URL, byte count, and digest. |
| `productionSigned` | The artifact carries an owner-approved production signature. |
| `storeReleased` | A named store publicly distributes the exact release. |

No state is implied by another state. A simulator run is not a device install; a
test signature is not a production signature; a repository directory is not a
deployment; and a Testnet asset is not a Mainnet asset.

## 1. Design goals

YNX Chain is being engineered around five bounded goals:

1. deterministic account and transaction state whose authoritative result comes
   from chain execution rather than a user interface or third-party API;
2. explicit separation between user custody, application permissions, service
   operations, and protocol authority;
3. evidence-linked applications for payments, trust, resources, development,
   and AI-assisted workflows;
4. recoverable operations with versioned state, observable failures, backup and
   rollback procedures; and
5. truthful release disclosure that distinguishes implemented, tested,
   installed, integrated, staged, public, signed, and distributed states.

The current engineering scope does not prove Internet-scale capacity,
permissionless validator participation, Mainnet economics, production custody,
stablecoin reserves, bridge liquidity, exchange liquidity, or sustained public
availability.

## 2. Network identity

| Field | YNX Testnet value | Authority |
| --- | --- | --- |
| Network name | YNX Testnet | Canonical network metadata |
| Native Testnet asset | YNXT | Canonical network metadata |
| EVM chain ID | `6423` / `0x1917` | `chain-metadata/ynx-testnet.json` |
| Comet/Cosmos chain ID | `ynx_6423-1` | Consensus migration and package schemas |
| Native decimals | 18 | Canonical network metadata |
| Official site name | YNX Chain | Public brand facts |
| Application ecosystem | YNX Web4 | Public brand facts |

The repository also contains a Mainnet draft. A draft identifier or configuration
must not be interpreted as an active Mainnet. Current public-facing claims must
identify YNXT specifically as the native Testnet asset.

## 3. Consensus architecture

The consensus candidate pins CometBFT `v0.38.23` and connects the YNX application
through ABCI 2.0. A deterministic migration export anchors account, supply,
validator, and related application state before the candidate starts.

The consensus path validates transactions in `CheckTx`, orders them through
proposal processing, applies them sequentially in `FinalizeBlock`, and commits
the resulting application hash. Durable account state and AppHash are written
atomically; a failed disk commit must not advance the in-memory height.

The local quorum gate creates four independent validator homes with distinct
Ed25519 validator and node keys. It checks:

- a common genesis and fixed-height block-hash convergence;
- expected validator identity and signer participation;
- a signed YNXT transfer through CometBFT RPC;
- continued commits after one validator and its application stop; and
- restart and catch-up of the stopped validator.

That gate is local quorum evidence. It does not by itself prove remote fault
tolerance or public decentralization. The production-candidate package keeps
validator and node private keys out of Git, binds four named operator roles by
public identity, hashes every packaged file, and keeps candidate RPC, ABCI, and
metrics on loopback. Remote deployment, fault drills, owner-signed transaction
drills, public ingress approval, and independent public proof remain separate
transactions.

Detailed behavior and limitations are specified in
`docs/whitepaper/STREAMBFT_SPECIFICATION.md` when published; until then,
`chain/consensus/README.md` and the consensus tests are the engineering source.

## 4. Accounts and native transactions

The current native transfer envelope is canonical JSON signed with secp256k1
ECDSA. The signer address is the lowercase EVM-compatible address derived from
the uncompressed public key. The signing domain `YNX_NATIVE_TX_V1` binds:

- envelope version;
- numeric chain ID;
- transaction type;
- sender and recipient;
- amount and fee;
- next account nonce; and
- compressed public key.

The application verifies the signature and does not store user private keys.
Sequential execution preserves total YNXT supply, increments nonce and measured
bandwidth usage, and moves traceable lots in deterministic order. The current
bounded native model uses a fixed fee; it is not evidence of a finalized dynamic
fee market.

User keys, seed phrases, arbitrary withdrawal authority, owner-change authority,
and reusable production signer material must not be transferred to a browser,
AI provider, application service, or documentation system.

## 5. Execution and EVM compatibility

YNX Testnet publishes EVM-oriented network metadata and development tooling,
including JSON-RPC expectations, Hardhat and Foundry configuration, contract
verification workflows, SDK helpers, and sample contracts. Compatibility is
bounded to the methods and behavior directly verified by the current tests and
public evidence. It does not imply universal compatibility with every Ethereum
client, opcode, wallet, indexer, exchange, bridge, or decentralized application.

Contract addresses must not enter public token lists or integration guides until
deployment, on-chain bytecode, source verification, chain identity, decimals,
symbol, and issuer authority are directly checked. The canonical Testnet token
list therefore remains empty unless those conditions are met.

## 6. Fees and resource accounting

YNXT is used in the current Testnet engineering model for native transaction
fees and resource accounting. The committed native-transfer implementation uses
an exact fixed fee and assigns that fee according to the current validator rule.
This is an implementation fact for the bounded runtime, not a promise of future
fee levels, validator income, token value, yield, or Mainnet policy.

Any later local fee market must define, version, and test:

- the unit being metered;
- base-fee or auction calculation;
- congestion and priority treatment;
- proposer and protocol allocation;
- rounding and denomination rules;
- maximum user-authorized cost;
- failed-transaction treatment;
- spam and denial-of-service resistance; and
- upgrade and rollback compatibility.

No revenue, burn, buyback, annual percentage yield, or profitability claim is
made by this whitepaper. Those claims require period-specific gross and net
figures, costs, risk, drawdown, lock and exit terms, network class, evidence ID,
and an explicit no-guarantee statement.

## 7. Staking and validator security

The migration and consensus packages represent validator identities and staking
state needed by the candidate network. A complete public staking specification
must separately define delegation, unbonding, rewards, commission, slashing,
jailing, governance control, key rotation, validator exit, and state migration.
Those economic rules are not finalized by the existence of validator records.

Liquid staking and a safety module are design candidates only until contracts or
runtime logic, audits, deployment, custody boundaries, liquidity, withdrawal
paths, insolvency treatment, and incident controls are directly evidenced. No
staking APY or liquid-staking redemption promise is made.

## 8. Wallet, authentication, and application permissions

The intended common trust path uses a canonical Wallet approval and product-
scoped Gateway session rather than long-lived browser bearer tokens or product-
specific compatibility logins. A complete accepted flow binds product identity,
bundle identity, device key, user account, scope, expiry, challenge, approval,
introspection, revocation, and audit records.

Every verifier must fail closed for replay, tampering, wrong product, wrong
bundle, wrong device, scope widening, expiry, and revocation. Candidate product
product candidates are not described as centrally integrated until the accepted protocol
and those negative cases pass on the central release line.

Applications may request bounded actions but cannot inherit custody. User assets
may reside only in the user Wallet, an explicitly disclosed exchange subaccount,
a user-approved strategy vault, an identified custody provider, or an approved
protocol contract. Strategy mandates require least privilege, asset and venue
allowlists, value and frequency limits, expiry, nonce domains, immediate
revocation, a kill switch, emergency exit, and auditable receipts.

## 9. AI governance

AI is a constrained suggestion layer. It may draft, explain, translate,
summarize, research, preview, simulate, propose, or generate a reviewable patch.
It must not independently sign, pay, trade, swap, withdraw, open a card, send a
message, publish content, delete data, change permissions, modify risk, change
issuance, operate treasury, upgrade consensus, or bypass human approval.

An AI-assisted action requires context consent, provider and model status,
resource or cost visibility where applicable, preview, approve/reject controls,
an audit record, and truthful failure behavior. A successful text generation is
not authoritative chain, account, balance, transaction, settlement, trust-case,
or permission state.

## 10. Payments, trading, and quantitative systems

YNX Pay engineering includes bounded intents, invoices, settlement verification,
receipts, and test flows. A public payment network additionally requires accepted
Wallet integration, merchant identity, production operations, refund and dispute
handling, and direct public evidence.

Exchange, DEX, and quantitative product candidates must preserve these rules:

- user profits and losses remain the user’s unless an explicit managed-vault or
  paid-service agreement states otherwise;
- fees must be disclosed and approved before the action;
- no service may hide spread, charge on unrealized profit, reset a fee basis to
  charge twice, fabricate volume or liquidity, or guarantee returns;
- market, order, balance, and settlement states must identify their authoritative
  source and freshness; and
- AI or a strategy engine cannot exceed the user’s signed mandate.

UltraLiquidity and FairFlow are not public performance claims until their
mechanisms, adversarial model, simulations, measured results, implementation,
deployment, and market-integrity controls are published with evidence.

## 11. Stablecoins, reserves, and redemption

YNX Chain does not claim support, approval, or partnership for USDT, USDC, or any
other issuer stablecoin. The local `ynx-stablecoind` control plane records review
and intent state, but execution is disabled: it has no signer, contract call,
external transaction, mint, burn, freeze, seizure, blacklist, or fund-movement
implementation.

Native YNXT and protocol staking, resource, and treasury state are rejected from
issuer control. A future stablecoin integration requires an identified issuer,
legal and custody review, canonical-versus-represented asset policy, reserve
scope, independent attestation, redemption terms, fees, timing, suspension and
insolvency treatment, incident response, deployment, and public evidence.

An issuer record, governance request, or evidence hash is a reference, not proof
of reserves or redemption capacity.

## 12. Bridge, oracle, and data boundaries

The local bridge coordinator persists transfer intents, rejects reused source
events, supports exact idempotency, verifies allowlisted Ed25519 relayer
attestations, requires configured finality and at least two relayers, and records
a hash-chained audit trail. It finalizes only local coordinator state.

External submission is disabled. There is no claimed external-chain transaction,
mint, burn, funded bridge account, production relayer custody, remote bridge,
public bridge endpoint, liquidity, or provider approval.

Oracle and market-data values are third-party or derived data unless written by
an approved YNX protocol mechanism. Each data record must identify source,
observation time, version, coverage or confidence where meaningful, and explicit
stale/unavailable/error state. Third-party data cannot substitute for YNX Wallet
identity, chain state, balances, permissions, transactions, settlements,
receipts, or Trust cases.

## 13. Trust, appeals, and market integrity

The Trust architecture treats evidence, request validity, rejection reasons,
appeals, correction, and transparency as explicit states. No interface or
external provider may silently convert an allegation, model score, cached value,
or third-party label into authoritative enforcement.

Controls that affect user access or assets require a defined authority, scope,
evidence reference, effective time, expiry or review date, appeal path, correction
path, and audit identifier. Native YNXT issuer-style freeze or seizure is outside
the current stablecoin control plane.

## 14. Product architecture

YNX Web4 is a portfolio of independent products connected through explicit
protocols. Wallet, Social, Pay, Exchange, Shop, Explorer, Developer, AI, Monitor,
Trust Center, Resource Market, Browser, Music, Video, Cloud, Docs, Search,
Finance, Mail, and Calendar retain distinct product identities and least-
privilege bindings. The common chain identity does not justify a super-app or
shared unrestricted session.

The portfolio includes engineering candidates at different maturity levels.
Only a component-specific release record may establish implementation, testing,
installation, integration, deployment, signing, download, or store status.

## 15. Security and supply chain

The repository’s baseline controls include environment validation, secret and
filler scans, bounded CORS and rate-limit policies, admin isolation, audit logs,
backup and rollback tooling, incident procedures, dependency checks, upgrade
policy, and AI permission limits. A complete release additionally requires a
threat model, security boundaries, SBOM, third-party notices, lockfile review,
build-script allowlist, SAST, DAST, container and artifact scans, provenance, and
reproducible-build evidence.

Public artifacts must identify an immutable URL, SHA-256 digest, byte count,
signing class, minimum operating system, source commit, and real installation and
cold-start evidence. Absence of a known vulnerability is not an audit opinion.

## 16. Operations and recovery

Schemas, state, APIs, configuration, and artifacts require explicit versions.
Release operations must cover migration, old-client compatibility, deprecation,
rollback migration, backup, restore drill, export and deletion, retention, and a
service-sunset exit path. Restart persistence alone is not disaster recovery.

Operational evidence must include structured logs, metrics, traces where
implemented, request/error/audit identifiers, health and version surfaces,
alerts, SLO dashboards, incident response, status communication, support,
refund/dispute handling where applicable, and recovery. User-facing errors must
not expose stacks, secrets, server paths, or provider credentials.

## 17. Performance and economics evidence

The project must not extrapolate a small local test into production capacity.
Capacity claims require measured p50, p95, and p99 latency; throughput;
concurrency; queue behavior; storage growth; provider latency and rate limits;
cold start; error rate; availability; and RTO/RPO, with hardware, software,
dataset, duration, and source commit recorded.

Unit economics require per-active-user infrastructure and provider costs, free
allowances, subsidies, support burden, candidate service revenue, and sustainable
gross-margin scenarios. Estimates must be labeled as estimates and separated
from observed invoices or usage.

## 18. Governance and change control

Protocol, economic, security, and release changes require versioned proposals,
review authority, compatibility analysis, test evidence, deployment approval,
rollback conditions, and public change records. AI may draft or explain a change
but cannot approve or execute consensus upgrades, issuance changes, treasury
actions, or risk-policy changes.

Mainnet activation requires evidence beyond this repository: independent
security review, economic and legal review, validator and key-ceremony approval,
remote fault and restore drills, public stress tests, governance setup, incident
readiness, and explicit release authorization.

## 19. Known limitations

As of the effective date:

- the documentation and public-disclosure package is incomplete and not deployed;
- independent public proof for all declared service endpoints is incomplete;
- product candidates are not automatically integrated into the central release;
- final token allocation, staking economics, liquid staking, safety module,
  treasury, revenue, burn, buyback, and Mainnet policy are not established here;
- no stablecoin reserve or redemption claim is established;
- the bridge has no enabled external execution or represented-asset liquidity;
- production custody, exchange liquidity, quantitative performance, and user
  profitability are not claimed;
- independent security, financial, and legal opinions remain required; and
- production signing and store release vary by product and require direct proof.

## 20. Evidence map

| Topic | Current engineering source | Evidence class |
| --- | --- | --- |
| Network identity | `chain-metadata/ynx-testnet.json` | Versioned repository metadata |
| Consensus and native transactions | `chain/consensus/README.md`, consensus source and tests | Local implementation and test specification |
| Deployment and rollback | `docs/deployment/TESTNET_DEPLOYMENT_GUIDE.md`, deployment scripts | Operator procedure; deployment requires separate evidence |
| Product boundaries | `docs/ecosystem/PRODUCT_ARCHITECTURE.md` | Architecture and delivery contract |
| Bridge | `docs/bridge/BRIDGE_INTEGRATION_READINESS.md`, bridge source and tests | Local coordinator only |
| Stablecoin control plane | `docs/stablecoin/STABLECOIN_ISSUER_READINESS.md`, service source and tests | Local non-executing control plane |
| Public proof rules | `docs/public-proof/PUBLIC_TESTNET_PROOF.md` | Required evidence contract |
| Current project state | `docs/acceptance/PROJECT_STATE.md` | Operator-maintained evidence ledger; entries require source verification |
| Release truth | `release/product-release.json` | Machine-readable candidate state |
| Completion gaps | `docs/acceptance/DOCS_COMPLIANCE_REQUIREMENTS.json` | Machine-readable audit |

## Change log

- 0.2.0-candidate (2026-07-22): Replaced the initial summary with a bounded
  technical disclosure covering identity, status semantics, consensus, accounts,
  execution, fees, staking, Wallet/Auth, AI, payments, trading, stablecoins,
  bridge/data, Trust, products, security, operations, economics, governance,
  limitations, and evidence sources.
