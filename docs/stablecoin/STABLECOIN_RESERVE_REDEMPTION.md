# YNX Stablecoin, Reserve, and Redemption Framework

| Metadata | Value |
| --- | --- |
| Version | 0.1.0-candidate |
| Effective date | 2026-07-22 |
| Accepted central source | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Framework and gap disclosure; issuer, reserve, redemption, custody and legal approval absent |

## Direct answer

YNX Chain does not claim an official stablecoin, issuer partnership, reserve,
redemption facility, peg, liquidity, production token, or public deployment. The
local `ynx-stablecoind` service is a persistent review control plane that records
issuer/asset applications and non-executing mint/burn intents. It cannot sign,
mint, burn, freeze, seize, blacklist or move funds.

Native YNXT is not a stablecoin. Stablecoin issuer controls must not govern native
YNXT, wrapped/native YNXT identifiers, gas/resource balances, validator stake or
protocol Treasury state.

## 1. Current control-plane boundary

The local service supports:

- issuer applications, approval/rejection and revocation;
- canonical/represented asset profiles;
- origin chain, contract reference, decimals, supply ceiling and reported supply;
- mint/burn policy and evidence references;
- asset approval/rejection and revocation;
- exact-idempotent, supply-bounded intent records;
- audit, transparency, health, metrics and mode-restricted persistence.

Every intent is `recorded_not_executed` with `executionEnabled=false`. An intent,
approval, evidence hash or governance reference is not proof that an external
review, reserve, token action or redemption occurred.

## 2. Issuer requirements

An issuer profile must identify legal name, registration, jurisdictions,
regulatory status, responsible officers, support/security/incident contacts,
governance, beneficial ownership where required, sanctions/KYC/AML program,
banking and custody arrangements, terms, privacy, audits and insolvency treatment.

YNX engineering approval cannot substitute for issuer authorization or legal
review.

## 3. Canonical and represented stablecoins

A canonical asset is issued under the issuer’s approved authority on the named
chain. A represented asset is bridged or wrapped and introduces bridge, relayer,
custody, contract, liquidity and redemption dependencies. Interfaces must state
which class applies and must not imply issuer support for a represented token
without direct issuer evidence.

## 4. Reserve policy

A reserve disclosure requires:

- eligible asset classes and exclusions;
- bank, custodian and account segregation;
- currency, jurisdiction and legal ownership;
- maturity, duration, credit and concentration limits;
- encumbrance, lending, rehypothecation and collateral policy;
- valuation source, timing and haircuts;
- accrued interest and who receives it;
- reserve frequency and independent attestation;
- operational cash and liquidity buffers;
- asset/liability reconciliation; and
- correction, incident and insolvency procedures.

An on-chain token supply plus an issuer-reported reserve value is not independent
reserve proof.

## 5. Redemption policy

Redemption terms must state eligible users and jurisdictions, onboarding and
sanctions checks, minimum/maximum, fees, supported bank/payment rails, request
cutoff, expected time, holidays, queue priority, partial fulfillment, suspension,
rejection and appeal, supported assets, exchange-rate/rounding, failed-payment
handling and insolvency rights.

Wallets and exchanges must distinguish secondary-market sale from issuer
redemption. A market price near one unit does not prove redemption access.

## 6. Mint and burn authority

Production mint/burn requires least-privilege threshold custody, separated
request/approval/execution roles, per-period limits, allowlisted contracts and
accounts, evidence-linked requests, timelocks where appropriate, key rotation,
emergency pause, recovery, audit and reconciliation.

Burn is supply destruction, not issuer revenue. A redemption burn must reconcile
the user liability, payout, token action, fees and failed/reversed states.

## 7. Freeze, seizure and blacklist

If an issuer has these powers, the public asset profile must disclose authority,
legal basis, scope, process, evidence, notice where lawful, effective time,
expiry/review, appeal, correction, transparency and incident handling. Such
powers must never be implied for native YNXT through the stablecoin service.

## 8. Reserve and liability evidence

Each attestation identifies entity, asset, network, contract, timestamp, included
and excluded reserves/liabilities, valuation, coverage, exceptions, attestor,
signature, immutable artifact and verification. A Merkle liability set requires
complete-account controls and privacy; inclusion alone does not prove completeness.

The broader solvency requirements are defined in
`docs/economics/PROOF_OF_SOLVENCY.md`.

## 9. Price, peg and liquidity claims

Any peg or price report identifies source, period, market coverage, gross/net,
spread, depth, slippage, drawdown/deviation, stale behavior, redemption access,
risk, network class, evidence ID and no-guarantee statement.

No YNX stablecoin peg, liquidity, reserve APY, yield or price guarantee is claimed.

## 10. Providers and data

Issuer, bank, custodian, attestor, KYC/AML, sanctions, payment, oracle, bridge,
analytics and monitoring providers require a provider register covering license,
terms, jurisdiction, authentication, rate limits, retention, data rights, version,
health, fallback and outage. Third-party data cannot override authoritative chain
or issuer records outside its scope.

## 11. Migration, recovery and sunset

Asset and intent schemas require versions, old-client behavior, migration,
rollback migration, backup, isolated restore, retention, data export/delete and
service sunset. Sunset must preserve redemption or an orderly user exit before
support ends. Restart persistence alone is insufficient.

## 12. Required activation evidence

1. Approved issuer and legal/custody review.
2. Production contract and source verification.
3. Reserve composition and independent attestation.
4. Redemption rail and end-to-end Testnet evidence.
5. Mint/burn custody ceremony and limits.
6. Accounting and supply reconciliation.
7. Bridge/oracle/provider contracts where applicable.
8. Threat model, audit, SBOM and incident/restore/rollback drills.
9. Public terms, privacy, risk, support and status.
10. Explicit governance and release approval.

## 13. Current release-state truth

| Capability | implementedLocal | testedLocal | deployedPublic |
| --- | --- | --- | --- |
| Issuer/asset review control plane | true | true | false |
| Non-executing intent records | true | true | false |
| Stablecoin token execution | false | false | false |
| Issuer support | false | false | false |
| Reserve attestation | false | false | false |
| Redemption | false | false | false |
| Peg/liquidity evidence | false | false | false |

## Change log

- 0.1.0-candidate (2026-07-22): Defined the non-executing control-plane boundary,
  issuer, canonical/represented asset, reserve, redemption, authority, evidence,
  provider, migration, activation and release-state requirements.
