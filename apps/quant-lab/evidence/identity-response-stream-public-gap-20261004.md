# Quant ordinary identity-response stream checkpoint

Predecessor: `58b6ad92b302b8bf541b51382ec69176e0037770`, tree `934a00096f912cff4da091554b3560e11fa98f8e`.

Scope: Quant ordinary browser identity response consumption and controlled tests only. No shared Wallet/Auth/SSO protocol, endpoint, permission, SDK, release pin, Host, or deployment changes.

The response reader bounds bytes at 16384 before retaining/decoding an incoming chunk; rejects oversized or malformed declared lengths, non-JSON responses, invalid and incomplete UTF-8; decodes split UTF-8 safely; cancels malformed/oversized/aborted streams and releases the reader lock. The existing same-origin credentials, no-store, redirect-error and ten-second request deadline remain unchanged. Standard Wallet and private service state are not coupled by this change.

## Executed local gates after resumption

`node --test apps/quant-lab/tests/browser-sso.test.mjs apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/ui-maturity.test.mjs`: 94/94 PASS, zero failures/skips, 3722.25625 ms. Four tests launch actual local Google Chrome: native Response/ReadableStream byte/UTF-8/abort checks, retired identity reads at logout, guest continuity with no automatic Wallet requests, and localized identity/logout lifecycle. Identity HTTP responses in these tests are simulated: this is not actual account approval or public runtime evidence.

`node --check apps/quant-lab/web/browser-sso.js` and `git diff --check`: PASS.

## Latest retained public readback (not rerun by this resumption)

GET-only observation time: `2026-10-03T17:36:49Z`.

| Product | Version endpoint | Public source | HTTP / bytes / SHA256 |
| --- | --- | --- | --- |
| Finance | https://finance.ynxweb4.com/version | 17d2d6dd0f9e30c7639bb5ccdf919c4896280e6c | 200 / 127 / 92eee2e51b111513df0f3637bf257aad8ac1d532c96a2e3640f6b07e7b5abaa8 |
| Exchange | https://exchange.ynxweb4.com/api/version | 91c1a40587d28ad4c931d4a4d601766bd467ea20 | 200 / 107 / b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8 |
| Quant | https://quant.ynxweb4.com/api/version | 664b80b00ac576317524f25b49fc01d1c0db7196 | 200 / 274 / f82629a1bd63e50f6721611cbf7866f86d7bffd51820b05a417590541c4653df |

These sources do not bind the current ordinary repairs. Health/liveness does not establish multi-instance storage or private-business acceptance. The inherited Quant formal asset-pin mismatch recorded in `guest-research-continuity-20261004.md` was not changed or rerun here; formal release graph reconciliation remains the release owner's task. The inherited bundled asset was not rebuilt by this source-only checkpoint.

## Remaining executable integration boundary

The release owner must integrate the ordinary source delta into its current Quant candidate, rebuild its owned final graph, enforce asset hashes, and obtain its authorized source-bound public release. This task cannot overwrite that shared/formal graph or deploy through an inferred authority. Only then can the actual public private-business/provider lifecycle be verified with immediate user confirmation at sensitive steps.

Published-current-source, actual provider approval, signatures, real orders/transactions, Product Session lifecycle, installed/native delivery, multi-instance production, Mac ComputerControl and full financial-goal completion remain NOT_VERIFIED. No SSH, server write, real Wallet/account request, signature or transaction occurred in this checkpoint.

Report destination: 接续测试网生态审计工作 (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`) only.
