# YNX Quant

| Field | Value |
| --- | --- |
| Version | 1.0.0-candidate |
| Effective date | 2026-07-22 |
| Evidence source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Quant candidate reviewed | `c97a7d568f87cc55f69c55309551830055943835` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Canonical | `https://ynxweb4.com/quant` |
| Title | YNX Quant — Paper Strategies, Mandates, Fees and Risk |
| Meta description | Understand YNX Quant candidate architecture, paper-trading boundary, user asset mandates, fees, market data and risk evidence. |
| H1 | YNX Quant |

## Direct answer

YNX Quant is a strategy research and lifecycle candidate. Paper trading,
simulation and backtests are not production execution or guaranteed performance.
A live strategy would require a user-signed, least-privilege mandate and approved
venue/vault/custody adapters.

## Asset boundary

Quant services, AI and frontends must never receive a user seed, arbitrary
withdrawal or owner-change authority. A mandate binds assets, venues, strategy,
value and frequency limits, risk limits, expiry, nonce domain, fees, immediate
revocation, kill switch, emergency exit and audit.

## Market data and performance

Every price and signal identifies source, `asOf`, version, coverage/confidence and
failure. Backtests disclose dataset, survivorship/look-ahead treatment, fees,
slippage, latency, capacity, out-of-sample method and drawdown. Paper fills are
not real fills.

Any PnL, yield or performance statement requires exact period, gross/net, costs,
risk, drawdown, lock/exit, network class, evidence ID and no-guarantee language.
No current public result satisfies that schema.

## Fees

Allowed fee candidates include disclosed compute/data/provider, subscription,
management or high-water-mark performance fees. No fee may apply to unrealized
profit or reset a basis to charge recovery twice. Hidden spread and guaranteed
returns are prohibited.

## Current status

The reviewed candidate includes local lifecycle and paper-service engineering.
Central Wallet/Gateway integration, live data/venue execution, managed vault,
production custody, public deployment, audit and legal approval are not claimed.

## Related pages

- [YNX Exchange](/exchange)
- [YNX DEX](/dex)
- [YNX Economics](/economics)
- [YNX Security](/security)
- [YNX Trust](/trust)
- [FAQ](/faq)

## Change log

- 1.0.0-candidate (2026-07-22): Initial strategy, asset mandate, market data,
  performance, fee, status and risk page.
