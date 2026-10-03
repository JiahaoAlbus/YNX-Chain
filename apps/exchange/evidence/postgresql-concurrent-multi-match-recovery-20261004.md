# Exchange multi-match process recovery and browser fixture closure

Predecessor: 77bcf13b2543733ec6d5efcecb4065a47da5ea78.
Scope: direct owned Exchange business tests and browser test loader only. No business engine, shared Wallet/Auth, authority, formal release pin, Host or product registration changed.

## Real process/database verification

New TestPostgreSQLConcurrentMultiMatchReplayConservesBalancesAfterRestart uses the retained isolated PostgreSQL 17.11 cluster on 127.0.0.1:64623, a unique temporary schema and two independent Exchange OS processes. Two controlled owners receive test funding; twelve separate maker orders rest, then twelve buyer intents are each sent concurrently to both processes (24 requests). CAS conflicts are not treated as new intents: explicit retries use exact original body/signature/key.

After both original processes close, a fresh third process reads the same PostgreSQL state. Exactly 24 orders and 12 matches exist. Each owner sees only its twelve orders/matches and own ledger/balances; all reservations are zero and available balances nonnegative. Ledger deltas reconcile. Per-fill maker/taker fees equal the configured integer rules; combined user quote balances plus fees equal original quote funding, and combined native balances equal original test funding. All twelve original buyer intents return exact committed order identities after restart; cross-owner reuse is rejected without leaking their identities. These retries do not change the persisted state digest, fees, audit or ledger. Public guest trades are independently bound by ID, timestamp, price, amount, source type and source digest to the exact persisted trades, without exposing owner addresses.

Focused -race run PASS (7.390s); three repeated -race runs PASS (17.734s). The exact final test including public provenance assertion is included in full `go test -count=1 -race ./internal/exchangeproduct` with real PostgreSQL configured: PASS (34.963s). Previously existing current/revision-layout, process-kill and HTTP/SSE tests run in that suite. This new multi-match case itself uses the current integrity schema; it does not claim additional schema-layout coverage.

Final temporary schema count is 0. The QA cluster was stopped cleanly; its data directory was retained. No production database or service was touched. Graceful process reopen here is not a mid-commit crash, power-loss, PostgreSQL failover or public chain settlement proof. All signing keys, Gateway authorizations and funding are isolated fixtures, not human/private Wallet material.

## Actual browser test repair and verification

Five existing candle-browser tests initially failed before exercising product behavior: their `export ` prefix stripping produced invalid `{date as isVenueTimestamp}` JavaScript after the production module gained an export alias. The owned test loader now removes standalone export alias declarations while preserving all implementation code; no production function or assertion was removed/changed.

Final market-data and real-Chrome candle group: 40/40 PASS (8.268s). Includes twelve-language rule timestamps, best seven price ordering, stalled-preview unlock without order creation, same-revision conflict stale labeling and explicit recovery, desktop/mobile exact retained OHLCV/provenance rows and bounded displays. Node syntax and git diff checks PASS.

Controlled local screenshots retained at /var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-candle-display-Hye319/ (not public screenshots, installed-native or Mac ComputerControl proof):

| Image | Bytes | SHA256 |
| --- | --- | --- |
| candles-320.png | 268612 | 691a93e85d85a8590032f117c2e0ec1c87c16b58bdcd2ef4eab3f52e745fdbb2 |
| candles-390.png | 287894 | c3bccb7779be321e38ec0aa11db810d29bc555b33f7963cb2ecb3b5498e7ae2c |
| candles-1440.png | 428817 | f263f3f354f98ec7f319d1e3386bcf4f2643c5732385d2d22fd6bb51c07c4f00 |

The 390px screenshot was inspected directly. Trace tables remain horizontally scrollable within their panels; the test data is explicitly controlled retained matches, not a manufactured public feed.

## Remaining release gate

Exact current-source public deployment, installed release, real selected-provider approval, Product Session and real financial operation remain unverified. Unique release owner must integrate owned source/test checkpoints with the accepted current authority graph and return source-bound public/rollback evidence. This checkpoint strengthens real local multi-process/database and browser evidence; it does not complete the financial ecosystem goal.
