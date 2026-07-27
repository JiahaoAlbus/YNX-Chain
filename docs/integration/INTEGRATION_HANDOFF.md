# YNX Quant Lab Integration Handoff

**Product:** 08 — YNX Quant Lab  
**Owner:** `08-quant-lab`  
**Contract:** `release/integration/ynx-quant-lab-contract.json`  
**Runtime source:** `8b211d08a67abc9e2b3d3f3254bbc87f4293b08e`  
**Evidence checkpoint:** `760a9559d142796b812ca8972805eac12d997363`  
**State:** Owner proposal; central acceptance and shared Testnet verification pending  
**Environment:** YNX Testnet only; live funds disabled

## What Quant owns

Quant owns strategy research, versioned datasets, deterministic backtests,
walk-forward and sensitivity analysis, Paper and Shadow operation, independent
risk enforcement, strategy lifecycle, bounded execution intent generation,
PnL/fee attribution, restart/reconciliation, and the Quant-facing half of
Exchange and DEX adapters.

Quant does **not** own Wallet identity or signing, Exchange matching or custody,
DEX Vault contracts, Oracle price facts, Chain finality, Data Fabric canonical
events, public Explorer facts, deployment authority, or production signing.
Those capabilities must remain behind their owner contracts.

## Current verified boundary

The local release gate passes Go tests and vet, browser/UI checks, twelve locale
catalog parity, Arabic RTL and 390 px overflow checks, Python and TypeScript SDK
tests, archive safety checks, Compose/Kubernetes syntax gates, reproducible
macOS/Windows candidate builds, release-record truth checks, and macOS install
and cold-start verification.

The Quant runtime implements concrete owner-transport Exchange and DEX adapter
constructors. A remote execution is completed only when a fresh terminal receipt
binds the exact adapter, request ID, sequence, requested amount, status, source,
version, coverage, confidence and audit ID. Nonterminal, stale, future,
malformed or mismatched responses remain `reserved_outcome_unknown`; retry does
not call the venue again. Reconciliation requires an exact authoritative delta,
and any nonzero delta must activate the persistent Quant kill switch.

This is a tested integration boundary, **not** evidence of a real Exchange or
DEX Testnet trade.

## Required owner inputs

### 02 — Wallet/Auth

Provide an accepted registry entry and canonical Product Session flow for:

- product client `ynx-quant-lab-v1`
- bundle `com.ynxweb4.quantlab`
- callback `ynxquant://wallet-auth/callback`
- P-256 device challenge
- ordered product scopes
- five-minute session maximum
- StrategyMandate verification, introspection, expiry and revoke propagation
- wrong-product, wrong-bundle, wrong-device, callback replacement, scope
  widening/reordering, unknown-field, future-time and replay rejection

Quant must receive only an attestation and bounded mandate facts. It must never
receive a private key, Seed, withdrawal credential or owner-change authority.

### 07 — Exchange

Provide a no-withdraw, subaccount-only transport that implements the operations
in the contract:

- execute one bounded order intent
- return a terminal `filled`, `rejected` or `cancelled` receipt
- expose authoritative cash/position reconciliation
- preserve request ID, sequence and audit correlation
- reject withdrawal, owner change, withdrawal-address change, credential export
  and risk widening

Accepted/open/partial responses are not terminal enough for Quant completion.

### 27 — DEX

Provide a user-owned Strategy Vault transport with a limited session key:

- only accepted Vault, pool/router and method set
- bounded Swap, DCA/TWAP, LP and rebalance operations
- terminal transaction/action receipt
- authoritative Vault reconciliation
- revoke and owner-authorized emergency exit
- no arbitrary transfer, owner change or unlimited approval

### 19 — Oracle & Market Data

Provide accepted versioned historical and live feeds with `source`, `asOf`,
`version`, `coverage`, `confidence`, stale/failure state and correction lineage.
Quant rejects missing-source, future, stale, nonpositive, insufficient-coverage
or unavailable observations.

### 26 — Data Fabric & Billing Ledger

Accept exactly one canonical schema/version mapping for Quant research,
lifecycle, mandate, execution, risk, PnL/fee, revoke and recovery facts. Local
audit event names are not yet central canonical events. Billing must reconcile
against real venue fees, funding, gas, compute and data usage rather than
front-end or manager assertions.

### 01 / 12 / 13 / 15 / 24 / 29 / 30

- Chain Core: Testnet finality, Faucet, transaction and receipt facts
- Explorer: public-safe transaction, order/fill, mandate/risk and release proof
- Monitor: risk, kill switch, reconciliation, pending-unknown and incident flow
- Trust: mandate-overreach and incorrect fee/PnL evidence and appeal path
- Finance: read-only user strategy and PnL view
- Integration: freeze one protocol version and run shared Testnet vectors
- Security/SRE/Release: deployed backup, scan, artifact and public release gates

## Required execution sequence

1. Freeze Wallet registry/session and StrategyMandate schemas.
2. Freeze Oracle observation and correction semantics.
3. Freeze Exchange and DEX terminal receipt and reconciliation schemas.
4. Freeze Data Fabric event and Billing Ledger mapping.
5. Run negative vectors before enabling any shared Testnet mutation.
6. Run bounded Exchange Testnet flow and retain raw evidence.
7. Run bounded DEX Vault Testnet flow and retain raw evidence.
8. Run risk breach, revoke, restart, reconciliation and recovery vectors.
9. Correlate Explorer, Monitor, Finance, Trust and Data Fabric facts.
10. Only then proceed to public deployment and immutable hosted artifacts.

## Open conflicts and migration

### Local preview versus canonical Wallet

Current local mutation routes require loopback and
`X-YNX-Preview-Mode: local-paper`. They are suitable only for research/Paper
preview. Migration must keep this local boundary while adding canonical Gateway
Product Session introspection for integrated access. Local mandate registration
must not be promoted; shared Testnet execution requires Wallet attestation.

### Local audit events versus canonical Data Fabric events

Current local append-only event names are evidence sources, not a second central
event protocol. Map them to one accepted Data Fabric schema through Integration.
After freeze, reject unsupported versions rather than silently supporting two
long-lived canonical forms.

## Release truth

Current release state:

- `implementedLocal`: true
- `testedLocal`: true
- `installedLocal`: true for the macOS local candidate
- `integratedCentral`: false
- `deployedStaging`: false
- `deployedPublic`: false
- `downloadHosted`: false
- `productionSigned`: false
- `storeReleased`: false

No HTTP response, local test, Paper fill, injected transport, Simulator,
cross-compile or ad-hoc signature may promote a later state without direct
evidence.

## Evidence required for acceptance

Use `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`. Each accepted vector must
retain source commits, raw request/response or event records, timestamps,
transaction/order/fill/Vault references where applicable, Explorer and Monitor
correlation, state/balance snapshots, and exact failure evidence for negative
cases. A narrative summary alone is not acceptance.
