# YNX DEX engine evaluation

Reviewed on 2026-07-18 for YNX Testnet EVM chain ID 6423. Repository HEADs were resolved directly with `git ls-remote`; licenses were read through the GitHub license API. This is an engineering comparison, not a legal opinion or an audit.

## Decision

YNX DEX v1 uses a clean-room, immutable constant-product pool implemented in this repository. No third-party AMM source was copied. The chosen scope is intentionally narrower than concentrated-liquidity or stable-swap engines: permissionless creation between allow-listed Testnet tokens, 30 bps swap fee, explicitly accrued protocol share, bounded four-hop routing, exact-input/output, LP mint/burn, cumulative-price observations, deadlines, min/max bounds, and a two-day public delay for token support, fee recipient, and governance changes.

This decision is Testnet-only. `mainnet=false`, `audited=false`, and `productionLiquidity=false`. A qualified independent audit, economic review, oracle review, malicious-token campaign, deployment ceremony, and owner-approved multisig are required before reconsidering that boundary.

## Candidates

| Candidate | Exact reviewed commit | License observed | Pool/routing model | Audit evidence observed | Upgrade/admin model | YNX compatibility and decision |
| --- | --- | --- | --- | --- | --- | --- |
| Uniswap v2 core | `6a9e7c97860676e0992f22a49665760444c1cdf5` | GPL-3.0 | Two-token constant product; routing is periphery/off-chain | No audit directory was present in the reviewed core repository root; this review does not convert community history into an audit claim | Immutable pair bytecode with factory fee controls in the reference design | EVM-compatible and operationally simple, but wholesale copying would impose GPL obligations and still require YNX-specific token, governance, Wallet, oracle and deployment review. Used only as a conceptual benchmark. |
| Uniswap v3 core | `d0831dc6b8a318df3872b6d68f6de135c9f3ec29` | Repository license text is BSL-1.1 with a 2023 change date to GPL-2.0-or-later; legal interpretation must be owner-reviewed | Concentrated liquidity, ticks and fee tiers; routing is separate | Repository contains ABDK and Trail of Bits audit PDFs plus Trail of Bits Echidna/Manticore material | Immutable pools with factory governance controls | Powerful but substantially larger mathematical, UX, indexing, audit and LP-risk surface. Deferred until v1 evidence and external review exist. |
| Curve StableSwap NG | `2abe778f40206a6c0fd108a0a53ad3266cbedeee` | Repository license states informational use only and grants no reproduction/distribution right except per-file exceptions | Plain/metapools up to eight coins, rate-oraclised/ERC-4626/rebasing support; native token unsupported | No audit claim was accepted from the repository root during this review | Factory plus blueprint/implementation selection | License is incompatible with copying; stable-asset assumptions and rate-oracle risk are not justified by the current reviewed YNX token set. Rejected for v1. |
| 1inch `1inchProtocol` | `811f7b69b67d1d9657e3e9c18a2e97f3e2b2b33a` | MIT | Legacy aggregation protocol; production Pathfinder routing is not delivered by this repository alone | No audit evidence was accepted in this review | Aggregator/router depends on external liquidity sources and routing services | GitHub reports this repository archived. It is not a self-contained maintained routing engine for YNX. Rejected; the SDK instead performs deterministic bounded routing over indexed YNX pools. |

## Risk comparison

- Constant product: simplest invariant and clearest LP UX, but inefficient for tightly correlated assets and vulnerable to ordinary price impact, arbitrage and sandwiching. It does not eliminate impermanent loss or MEV.
- Stable-swap: efficient near a peg, but unsafe when assets, rate providers, rebasing behavior or depeg recovery are not deeply reviewed.
- Concentrated liquidity: capital efficient, but adds tick/range accounting, inactive positions, fee-growth arithmetic, oracle observations, more difficult routing and materially harder LP UX.
- Aggregation: can improve execution only when multiple trustworthy venues and a maintained route computation service exist. It adds quote freshness, route trust, allowance and external-liquidity dependencies.

## Oracle and routing decision

Pools expose cumulative reserve-price observations. Consumers must calculate TWAP over two observations and enforce a minimum interval; the instantaneous reserve ratio is not a manipulation-resistant oracle. The SDK enumerates simple paths without repeated tokens/pools, caps routes at four hops, and chooses deterministically by output/input. Transaction review must disclose every pool, fee, impact, deadline and warning. No component claims to eliminate MEV.

## Sources

- <https://github.com/Uniswap/v2-core/tree/6a9e7c97860676e0992f22a49665760444c1cdf5>
- <https://github.com/Uniswap/v3-core/tree/d0831dc6b8a318df3872b6d68f6de135c9f3ec29>
- <https://github.com/Uniswap/v3-core/tree/d0831dc6b8a318df3872b6d68f6de135c9f3ec29/audits>
- <https://github.com/curvefi/stableswap-ng/tree/2abe778f40206a6c0fd108a0a53ad3266cbedeee>
- <https://github.com/1inch/1inchProtocol/tree/811f7b69b67d1d9657e3e9c18a2e97f3e2b2b33a>

No incident absence is claimed. Incident history remains an external due-diligence workstream before mainnet consideration.
