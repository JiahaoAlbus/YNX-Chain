# Unit economics

No revenue, APY, liquidity, user count, conversion, or profitability is claimed.
There is no public usage or provider invoice evidence yet.

## Cost model

Per-active-user cost must be calculated from measured monthly values:

`(compute + storage + egress + market data + venue/provider + support + monitoring + signing) / monthly active funded-testnet users`

Track separately:

- research CPU-seconds and stored dataset bytes
- backtest/optimization worker seconds and queue occupancy
- market-data requests, streamed bytes, and licensed-user tiers
- Exchange and DEX provider calls, rate-limit headroom, and failed-call cost
- audit/evidence retention, export, backup, and restore storage
- desktop download bandwidth and signing/notarization fees
- support minutes, disputes, abuse review, and incident load

## Permitted fees

Self-managed strategies have no default performance fee. Any subscription,
compute/data fee, venue fee, gas, provider cost, management fee, or managed-vault
high-water-mark performance fee requires prior user disclosure and auditable
consent. A managed-vault performance fee may apply only to realized net profit
after all costs, with loss carry-forward. Hidden spread, unrealized-profit fees,
volume fabrication, guaranteed return, and secret mint/burn are prohibited.

## Decision gates

Do not scale paid service until invoices and usage prove provider cost per active
user, gross-margin candidate, subsidy budget, support load, and retention. Kill
or redesign if provider/data rights cannot support the intended use, contribution
margin remains negative outside an explicitly approved subsidy, or risk/support
load exceeds the operational budget.
