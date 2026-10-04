# Exchange normal-cache consumer recovery and public gap

Reviewed runtime source: 97a259368d533d97e1fcc5396e04663df19e7a12 / tree 1a5d239dea040b6a052a7c5dca58d40058869d3b. No runtime, shared SDK or release executor bytes changed in this successor.

Existing cache browser test first failed: 0 pass/1 fail, 1474.44925 ms, missing a fresh network request for market-data.js. Diagnostic rerun also failed (1320.30925 ms): current app, order-preview, private-session and locale were requested and current public snapshot GET executed; market-data was reused from the prior page's hash-identical module dependency. This was an invalid network-count assertion, not proof of stale financial code. Normal cache remains enabled; no cache clearing, forced query nonce or deadline extension added.

The test now checks the exact source-hash URL, HTTP 200 and complete browser-response bytes for all eight page/module assets, preserving the assertion that unversioned old app remains cached while the new versioned app equals current source. It additionally requires actual current-module public snapshot execution, zero uncaught current-page errors, GET-only traffic and stable URL. Actual installed Chrome headless test: 1 pass, 0 fail/cancel/skip, 1411.937 ms. Intermediate byte-verification run: 1 pass, 1320.547042 ms. Versioned-asset verifier passes (4 page/4 module assets); syntax/diff checks pass.

Existing native Go checks: `go test ./internal/exchangeproduct/... ./apps/exchange/server/...` passed in 6.339 s and 0.757 s. These are local service tests, not new public matching, account authority, signing, installation or external-chain acceptance.

Fresh read-only public GET observations in this turn, no auth/Wallet interaction:

- https://exchange.ynxweb4.com/ — 200, 15995 bytes, text/html; charset=utf-8, SHA256 e19bfb7281f35515b5d5648f893803af94ea3a0c64ed46d766f3495a8e7b63ab; app pin 74d389577a2c4cfa0c8f747f51b43274bf4bc209cafe694392942e125c8dc562.
- https://exchange.ynxweb4.com/version — 200, same 15995-byte HTML and same SHA256; not JSON version evidence.
- https://exchange.ynxweb4.com/health — 200, same 15995-byte HTML and same SHA256; not service health evidence.

Current ordinary app SHA256 da54021fe2f177463320ed6411c5238113ec8156198a2291ad45a42f26bad1af differs from public pin. Formal public composition/cutover remains with unique wallet_release_owner A; this source owner must not replace shared graph, publish registry/Host or infer a deployment lease. Required next release action: compose exact ordinary app+HTML consumer into A's authoritative complete product graph and source-bound publisher, preserving full rollback; independently return public bytes/metadata and actual product journey. Public/current-source, installed release, real account/order/signature/transaction and user acceptance remain unproven.
