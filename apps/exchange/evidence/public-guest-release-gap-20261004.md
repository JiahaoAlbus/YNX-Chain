# Direct public Exchange guest envelope and publication gap

Source predecessor `61cd02ee76c5d2340d8be57f49daa5b2c81dcf88`, tree `1dac614662ed634e0a3a1a17a06a29f33347effd`. This evidence is direct public guest read-only observation, not current-source publication, Wallet/provider approval or real trading acceptance.

## Actual public Chrome observation

Two fresh isolated headless Google Chrome contexts opened `https://exchange.ynxweb4.com/#market`, width 390 and 1280, height 900. Observations `2026-10-03T18:01:44.053Z` and `2026-10-03T18:01:52.569Z` respectively. Each settled 6500ms. Final URL stayed exact; one tab; `lang=en`; no horizontal overflow; no pageerror; no attempted non-GET/HEAD/OPTIONS request (the guard would abort such a request). No provider/account/sign/typed-data/order/transaction interaction.

Both rendered `Connected · single-host test data`, actual source coverage `stream-orderbook-matched-trades`, 20 visible retained trade rows. Both had **no `#chart-interval`**, whereas the owned source has 1m/5m/1h retained-trade aggregation. Each observed two public snapshot 200 / stream 200 request pairs; final URL stability does not prove absence of intermediate guest identity navigation or complete identity recovery. No account connection completion is claimed. This is not Mac ComputerControl evidence.

Readback in each browser context:

| Endpoint | HTTP | Bytes | SHA256 |
| --- | --- | --- | --- |
| /api/version | 200 | 107 | b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8 |
| /api/health | 200 | 307 | 9d16623ea43cc49bd257b1043c14bd1f1cd1d68a8df4b8e754a1ff2c5dbdc7de |
| /api/v1/market-data/snapshot (390) | 200 | 9854 | ad021be5d24fe53cd1e63165aa25efd55b07e7a3dee6d51585ec00be1f8b90d5 |
| /api/v1/market-data/snapshot (1280) | 200 | 9852 | 678f23cbf4c3ddb583aad128a6d2c1802d170dd9b9a162a6c0b65a4ee4d5f819 |

Version and health bind old public source `91c1a40587d28ad4c931d4a4d601766bd467ea20`, not this owner branch. Snapshots revision 478, retained trades 30, bids 3, asks 0, classification=testnet, status=degraded_single_host, backend=file_snapshot, multiInstance=false. Source asOf differs (`2026-10-03T18:01:44.005019053Z` and `2026-10-03T18:01:52.52331316Z`) and accounts for response-byte/hash changes; observation time is not a new matched trade. No live/executable quote or production DB acceptance is inferred.

## Exact ordinary source inputs for release-owner integration

These are read-only Git-object identities from the predecessor, **not a coherent final release graph**. Release owner integrates ordinary hunks against its current authority and rebuilds its own entrypoint/bundled shared adapter/asset pins; do not replace its whole checkout or copy protected protocol.

| Owned source path | Git blob | Bytes | SHA256 |
| --- | --- | --- | --- |
| apps/exchange/web/app.js | a65f34ff0ad821efba7568abf59f87f80828ca99 | 44671 | 801a2d3eb1924b83908fd01d531543b4f9406736a08c5487ca27f240d21ac789 |
| apps/exchange/web/styles.css | 0f069a50737d0871b7c0402880f9a49ccb09805e | 13302 | 05cc5bb35872b4f3c33182bc25a9055760fabde6d548a999ebcca3992626f198 |
| apps/exchange/web/locale.js | 94bb8a9d30e3285df7edff3117ed5f7be60f32b6 | 170803 | b8b7ce7e1a7e3ea487c246f5cbdba733db88f2fd74a8442e764f9341bfae0781 |
| apps/exchange/web/market-data.js | c526c0f0f486ccad24dd9cb1f2a0a0d01069c186 | 15941 | cd6c06338a9fdfaf1889f79ac324b527412197a35ef2ce0e025fbcfd644525b6 |
| apps/exchange/web/private-account-controller.js | 1d697a2f36556c1443dbe4ffbf95ecdbe1f932f9 | 15877 | 1c4921d5ad03fe8372b1c97a93b55dde679a22dc089ab3436a87fe3fa287ec31 |
| internal/exchangeproduct/service.go | 7771fe4ad00dd3425ff285e1b1da84704e68d470 | 132892 | 56faed53eddb4ad14474d9bad6d769b0ae50da9986e0e88a0341b195de3d5781 |

The inherited CSS/index-pin mismatch remains separately recorded; these hashes do not bypass that release gate. Initial attempted source inventory used a nonexistent `exchange-locale.js`; actual repository inventory corrected it to `locale.js` before freezing these identities.

## Concrete unresolved gate and next action

Publish current ordinary Exchange source in the release owner's exact final graph, then return source/asset version readback for public guest candles/reconnect and user-confirmed private journey. Host/formal graph remains exclusively release-owned; this task did not deploy or mutate it. PostgreSQL tests remain unexecuted: local docker CLI reports daemon unavailable and no postgres/initdb/pg_ctl/psql was found. Do not connect an arbitrary or production database to destructive integration fixtures; an isolated dedicated test DB is required. Existing file CAS is not a replacement for the requested multi-instance DB result.

Long-term goal remains incomplete. Direct public guest rendering is proven only for the old version above; current source publication, native installers, actual Wallet/private business, signs/orders/transactions, PostgreSQL multi-instance and ComputerControl are not promoted. All issues route only to 接续测试网生态审计工作 (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`).
