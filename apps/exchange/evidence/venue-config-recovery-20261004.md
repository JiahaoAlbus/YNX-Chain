# Existing public venue configuration — actual consumer and recovery

Owner predecessor 8122d8114b3b8d175a987971bedc0642d0ce632f / tree b3f4c5a3fef1c4b278949a2f108ebb3662754b56. Original isolated owner branch retained. DEVELOPMENT_AUTONOMY_20261004.md fully read; ordinary product API/UI development does not wait for Root/A approval. Shared registration/main/Host remain single-writer and user account/sign/send boundaries remain unchanged.

## Defect and actual correction

Existing internal/exchangeproduct/server.go config handler and Service.Networks expose public chain/native/custody/network/confirmation/fee facts. The ordinary Web app never read it: state.config remained null, fee could not be observed, and boot permanently replaced custody with an unavailable workflow label.

New venue-config.js reads only /api/v1/config via credential-omitting same-origin GET, no proof/body/write/signature. It enforces JSON MIME, 256 KiB declared+stream bounds, fatal UTF8, duplicate-key/depth parser, identity length framing, exact 6423/ynx_6423-1/native asset, unique asset-network rows, safe integer fees/confirmations, and current nonbroadcast/noncrosschain/venue-credit boundaries. The optional fee field is not fabricated as zero. Result is explicitly writeAuthorized=false/nativeAddressVerified=false. No installed-provider or checksum claim.

5-second deadline covers fetch+body, cancelled/older requests cannot repopulate observations, newer explicit refresh wins, and 120-second local freshness deadline/offline/pagehide drops usable config. These are local observation deadlines, not a server-signed execution fee. App renders actual observed fee/address, clears stale fees/receive values, closes withdrawal review on refresh/change/loss, retains amount/destination and Standard Wallet state. Actual Refresh button is in the asset workflow; online and BFCache restore only reread public config, never replay a write. Deposit still requires a separate approved owned intent; showing custody is not authorization to transfer.

## Fresh direct public GET (one read, zero writes)

https://exchange.ynxweb4.com/api/v1/config returned HTTP 200, application/json; charset=utf-8, 1685 bytes, SHA256 7da5f906a25223112c1c317dd531d71936105383ec2c50530b5a747f9b9059c5. Current config structural contract accepted its data. This proves that particular old public endpoint is readable, not that the new app is deployed or the current source/public version is bound. Public sourceBound=false. Prior health/version HTML-fallback evidence remains open independently.

## Checks and frozen identity

- Initial relevant combined regression: 15/16; new browser expected 0.4 but existing formatter intentionally returns 0.40. Corrected expected display only, did not change arithmetic or formatter.
- Combined command/config/owned-control/UI suite: 31/31 PASS, 20755.937708 ms (before adding the actual Refresh button).
- Final focused real module+DOM/button/config suite: 5/5 PASS, 1897.891916 ms; 390 and 1280 widths, four GET observations each, no proof/authorization headers, no non-GET, one tab, pageerror0. Controlled routing/input only; not public installed/account evidence.
- Final UI suite 13/13 PASS, 73.171667 ms. Actual static graph 4 page assets + 7 exact app-module hashes PASS; foreign modules still fail closed.
- Expanded real Go static serving tests cover new command/config modules, exact bytes and JavaScript MIME: go test ./apps/exchange/server/... PASS, 0.370 s.
- Syntax and diff gates PASS. Historical release helper mismatch from predecessor is not modified or reclassified as completion; no need to rerun unchanged old release gate for this new public reader.

venue-config.js blob 26c34f761db9dec1bffdb91f6e07e15033434b1f, SHA256 1e10bb20aa713dffe505321a5fc03c9109f651c965c3ae5a0edfff6504d90b61.
app.js blob 10bd840d9352982bf30416e6c8e70653e5972893, SHA256 d017664dbd4857e81a16258926503a2b41723da016661a560270d09cf74e99b1, HTML pinned exactly.

Product command authority/accepted v2 write route and native signing remain separate. No shared Auth/SDK/registration/Host/backend logic change in this checkpoint; server change is ordinary static-serving test coverage only. New module must be included in the eventual exact formal Web graph, not omitted by an older 17-file package. No deployment/installer/real Wallet approval/financial command/generation/full-product completion is claimed.
