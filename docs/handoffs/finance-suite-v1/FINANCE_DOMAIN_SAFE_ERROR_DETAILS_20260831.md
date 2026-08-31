# Finance-domain safe error-details boundary — 2026-08-31

## Source checkpoint

The Finance-suite shared-domain checkpoint is
`e0abee147fbbd715ce05fd8fd37ea594e79864b9` (tree
`1f6034586cdc312322bb705b9ab079d775545ccf`). It hardens only the local
`createError` boundary; it changes no Wallet/Auth, product, service, public
route, release record, database, or transaction behavior.

| File | Git blob | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `packages/finance-domain/src/index.js` | `fffce1990165ec72c368a93b7a51e7477b9da42e` | 23,187 | `4a1f1a5dd042e8d95d5c66a3a7226a6151888acab1812f4463a005cb6d237511` |
| `packages/finance-domain/src/index.d.ts` | `714312fcc26a5d5d462aa4cc1313d79206a0d3a6` | 4,116 | `2d520b4d686593de1de0803ad0e05f068e92825e0ddd45e461760bb9943b01f4` |
| `packages/finance-domain/test/domain.test.mjs` | `e5a7ed556968f7df7168758e9ea21f16dacde54e` | 13,959 | `9ba0e1b96958a93c0ff924a5dac90a7377d870e0de39d416085a839819bcd2bf` |

## Contract effect

`createError(...details)` now accepts only a bounded JSON-compatible value:
plain records, arrays, finite numbers, booleans, strings, and null. It clones
and freezes the accepted structure. It rejects cyclic values, accessors,
non-plain objects, overlarge/deep payloads and credential-like keys after
normalization, including private keys, seed phrases, mnemonics, passwords,
secrets, access/refresh/session/auth tokens, authorization, cookies and API
keys. The stable `FIN_*`, request ID and retryable fields are unchanged.

This supports the Fable5 rule that financial logs and error envelopes must not
leak private keys or recovery material. It is a local consumer boundary only:
Central must decide whether a future accepted transport schema should expose a
corresponding `details` shape. No existing Central schema or error protocol was
overwritten by this checkpoint.

## Verification and truth

`npm test` in `packages/finance-domain` passed 12/12. New coverage proves a
safe nested diagnostic payload is recursively frozen and rejects private-key,
mnemonic, function and cyclic payloads. This does not prove any public error
route, deployed binary, Wallet lifecycle, order, swap, liquidity operation,
strategy, signing, custody, or Testnet transaction.

