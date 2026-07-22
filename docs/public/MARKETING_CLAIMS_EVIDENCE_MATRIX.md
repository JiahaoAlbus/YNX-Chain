# YNX Marketing Claims Evidence Matrix

| Metadata | Value |
| --- | --- |
| Version | 1.0.0-candidate |
| Effective date | 2026-07-22 |
| Evidence source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Editorial gate; legal approval pending |

| Claim ID | Proposed public claim | Decision | Evidence | Required qualifier / reason |
| --- | --- | --- | --- | --- |
| CLM-001 | YNX Chain is a Web4 Layer-1 ecosystem. | Approved candidate wording | Canonical brand facts and architecture | “Web4” is a YNX product term, not an adopted Internet standard claim. |
| CLM-002 | YNX Web4 is the application ecosystem powered by YNX Chain. | Approved candidate wording | Canonical brand facts and product architecture | Products remain independent. |
| CLM-003 | YNXT is the native Testnet asset. | Approved | Canonical Testnet metadata | Must include Testnet; do not imply Mainnet/value. |
| CLM-004 | YNX Testnet uses EVM Chain ID 6423. | Approved | Canonical Testnet metadata and checks | Also disclose `0x1917` where relevant. |
| CLM-005 | YNX is not affiliated with unrelated Lynx-branded products. | Approved neutral disambiguation | Canonical brand facts | No criticism or comparison. |
| CLM-006 | YNX runs StreamBFT publicly. | Rejected | Shadow candidate evidence | Public network is not claimed to run it; accepted baseline is CometBFT/ABCI. |
| CLM-007 | YNX has a locally tested StreamBFT shadow candidate. | Approved with exact status | CON-008 and reviewed candidate source | Must say disabled, non-central and not public. |
| CLM-008 | YNX has dynamic local fee markets. | Rejected as current policy | Shadow candidate source only | May describe a locally tested disabled candidate, not active fees. |
| CLM-009 | YNX burns 100% of fees. | Rejected | Candidate simulation is not active | Current fixed fee has zero burn; candidate base-fee burn is review input. |
| CLM-010 | YNXT has a 1%–8% annual issuance policy. | Rejected as active policy | Economic simulator candidate | May describe candidate simulation defaults only. |
| CLM-011 | YNXT has a final allocation or fixed circulating supply. | Rejected | Missing | No approved allocation/circulating methodology. |
| CLM-012 | YNX staking yields APY. | Rejected | Missing complete staking lifecycle | No APY claim. |
| CLM-013 | YNX offers liquid staking or a Safety Module. | Rejected | Missing | Design requirements only. |
| CLM-014 | YNX has an official stablecoin. | Rejected | Stablecoin control plane is non-executing | No issuer, reserve, redemption or token. |
| CLM-015 | YNX supports USDC through an official route. | Rejected | Owner provider record says unavailable; independent refresh incomplete | No official YNX route/contracts/funding evidence. |
| CLM-016 | YNX Bridge is live. | Rejected | BRG evidence is local coordinator only | External submission and destination execution disabled. |
| CLM-017 | YNX publishes proof of reserves/solvency. | Rejected | Framework only | No complete asset/liability attestation. |
| CLM-018 | YNX supports EVM-oriented Testnet interfaces and tooling. | Approved with bounded scope | Metadata, SDK, Hardhat/Foundry and verification tests | Do not imply universal Ethereum compatibility. |
| CLM-019 | YNX has four independent global validators. | Rejected | Four operational roles do not prove independent ownership | May state exact local/remote operator-controlled evidence only. |
| CLM-020 | YNX Testnet is publicly deployed and independently verified. | Not approved for this package | Historical operator evidence; current service check incomplete | Require fresh independent endpoint/release proof. |
| CLM-021 | YNX products are production released. | Rejected as portfolio claim | Product states vary | Publish component-specific booleans only. |
| CLM-022 | YNX Wallet/Auth is centrally integrated across all products. | Rejected | Candidate/integration queue evidence | Require central accepted protocol and negative vectors. |
| CLM-023 | YNX AI autonomously executes transactions. | Rejected | AI governance boundary | AI may draft/propose; authority remains human/Wallet/Gateway. |
| CLM-024 | YNX guarantees returns, liquidity or price. | Rejected | Prohibited claim | No guarantee. |
| CLM-025 | YNX has hidden spread, secret buyback or guaranteed burn support. | Rejected | Economic policy | Fees/actions require disclosure and evidence. |
| CLM-026 | YNX is audited or legally approved. | Rejected until named evidence | Independent reviews missing | Draft engineering/legal analysis is not an opinion. |
| CLM-027 | YNX’s main website responds publicly. | Approved as dated observation only | REC-006 | Does not prove this package or service subdomains are deployed. |

## Capital-claim gate

Any APY, PnL, yield, reserve, liquidity, burn, buyback, staking, vault or revenue
claim requires source, period, gross/net, costs, risk, drawdown, lock, exit,
Testnet/production class, evidence ID and no-guarantee statement. Without every
field, reject the claim.

## Review workflow

1. Assign a stable claim ID.
2. Link direct evidence and exact source/release.
3. Classify authority, date, coverage and failure.
4. Add risk and status qualifiers in the same prominence.
5. Obtain technical review and applicable economic/legal/security review.
6. Publish only the approved wording.
7. Withdraw or correct the claim when evidence expires or changes.

## Change log

- 1.0.0-candidate (2026-07-22): Added canonical, consensus, economics, staking,
  stablecoin, Bridge, solvency, EVM, validator, deployment, product, Wallet, AI,
  guarantee, audit and website claim decisions.
