# Finance direct public guest runtime envelope

Owner source predecessor `7fd834ece38e679b209241f96c01103614fd1a67`, tree `e294e77197aac9196185c030dc1f32ce70b6bf0d`. This evidence does not bind that owner source to the public runtime.

## Direct observations

Installed Chrome, two fresh isolated headless browser contexts, viewports 390x900 and 1280x900, opened `https://finance.ynxweb4.com/` and settled for 3 seconds. Observation UTC times: `2026-10-03T18:30:32.226Z` and `2026-10-03T18:30:36.250Z`.

Both final URLs: `https://finance.ynxweb4.com/#overview`; document title YNX Finance; language en; one tab; no horizontal document overflow; no pageerror. A network guard aborted any non-GET/HEAD request; no such request was observed/blocked. No account, connect, authorization or transaction button was clicked. No authenticated cookies or fixture identity were injected.

Visible text includes: Finance service reachable / Wallet not connected; Reconnect YNX Chain; Sign in across YNX products; Browser identity separate from Wallet connection and private Finance approval; No account data is shown in guest mode; Missing balances, quotes and performance are not estimated; Testnet assets are not mainnet funds. Desktop also shows No custody / Finance is not a bank account. Twelve language options are visible. This does not test language-change behavior or all navigation actions.

Exact direct public responses were identical for both contexts:

| Route | HTTP | Bytes | SHA256 |
| --- | --- | --- | --- |
| /version | 200 | 127 | 92eee2e51b111513df0f3637bf257aad8ac1d532c96a2e3640f6b07e7b5abaa8 |
| /health | 200 | 544 | 7e6f037a79c7dce4780437087e09c7e4227fa23797b84292d47371d6d6061476 |

Version JSON:

```json
{"commit":"17d2d6dd0f9e30c7639bb5ccdf919c4896280e6c","release":"root3-lifecycle-17d2d6dd0","buildTime":"2026-10-03T01:40:39Z"}
```

Health reports that exact build, chainId ynx_6423-1, configuredReadSources dex/exchange/quant, custody none, ready/not draining/activeRequests0, multiInstanceState=false, stateStore=file-cas-single-host, portfolio=read-only, truthfulStatus=runtime-upstream-backed, service ynx-finance/version1.2.0. These are server readback fields, not an independent verification of each upstream.

## Remaining release actions

The public guest surface is directly observed usable at these two sizes; own-account reads/expiry/sign-out/cross-account/reports/export, Wallet approval and native install were not exercised. No screenshot or Mac ComputerControl claim is made. HTTP 200 does not prove multi-instance or complete financial delivery. Exclusive release owner must integrate current ordinary source into a coherent formal graph and provide exact published inputs/runtime binding; original owner then repeats owned public workflows at that release. Isolated PostgreSQL verification remains separate.

The first local probe failed before browser launch because root package resolution could not find playwright. Reusing the existing quant-lab installed dependency resolved it; no dependency install/global change was made. No Host or production mutation occurred.
