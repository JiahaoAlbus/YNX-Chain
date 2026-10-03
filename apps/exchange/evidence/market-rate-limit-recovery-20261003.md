# Exchange public market rate-limit recovery

Parent ordinary-source checkpoint: 9974d7f97e68b7940239ec184b9e3669806c98e5.
Scope: Exchange public-read market adapter and matching tests only. No Wallet,
identity, order grant, SDK, Host, persistence or shared release changes.

Automatic recovery previously ignored HTTP 429 Retry-After and used only the
1–30 second exponential retry. It now accepts positive delta seconds or the
standard IMF-fixdate HTTP date, bounded to 300 seconds and never shorter than
existing backoff. Malformed, zero, negative or elapsed values retain ordinary
backoff. A valid HTTP snapshot resets attempts, including polling-only recovery.
User explicit retry remains an explicit fresh GET, not an order retry.

429 does not replace the last verified snapshot, create prices or label cached
data live. Old streams are retired, pending automatic retry is cancelled by
stop/offline, and successful recovery requires a newly validated same-origin
GET. No account credentials or write actions were added.

Executed node tests market-data/candles/order-preview: 45/45 PASS. New transport
regression exercises delta/date/upper-bound/invalid headers, exact timer delay,
cached-state preservation, restored revision, backoff reset and GET/omit-only.
These controlled transport fixtures are not actual public rate-limit evidence.

Real local Chrome served-source browser regressions candles-browser,
owned-controls-browser and locale-browser: 24/24 PASS, 33716.517083ms. Covers
stalled read preview recovery, revision-conflict stale chart/retry, desktop/mobile
read-only candle display, 12-language forms/records/Wallet statuses, account
isolation and unchanged write boundaries. Browser API responses are controlled
local fixtures, not real public fills, Wallet approval or private business proof.
Retained local chart screenshots:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-candle-display-Qm9ERC`.
JS syntax and git diff --check PASS.

Public source binding, installed delivery, real account approval/orders and
Product Session remain unverified here. Formal coherent release must be
integrated by the unique release owner; do not publish this inherited checkout
or assume source tests update the public runtime. Ordinary rollback is this
isolated adapter/test delta, not a shared-authority rollback.
