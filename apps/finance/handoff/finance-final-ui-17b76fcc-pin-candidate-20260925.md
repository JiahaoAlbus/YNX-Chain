# Finance UI and verifier candidates — independent review required

Owner source predecessor: `17b76fcce21988af6b5fd337b825078c936c6762`, tree `588142489f097ff6074dbd57e1815d5f92865eba`, branch `codex/finance-evm-read-session-pr193-20260924`.

The UI fix removes static locale translation from dynamic Broker review nodes and re-renders only the same in-memory exact request on EN/zh changes. Local Chrome fixture proves ACME/side/quantity/limit/maximum/fee/expiry remain visible, the review URL stays byte-identical, no second challenge is issued, and a cleared request is not revived by switching languages. The focused owner subset passed 63/63. This fixture does not prove an actual Wallet approval or Broker execution.

| Candidate | Git blob | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `apps/finance/evidence/evm-read-runtime-verifier-candidate-final-ui-17b76fcc-v3-20260925.json` | `fd6a6246b441aad286b0a65799cfcbc2a89b4179` | 6059 | `514c92e996081e9cbec27db31242957df2307ae7c9961449213e8f01a26c771c` |
| `apps/finance/evidence/wallet-verifier-manifest-final-ui-17b76fcc-v3-20260925.json` | `3ebb19a3405aa12adf0d56a3394115e165ba0606` | 5430 | `6b2caea6b38e89e975bd574e28062fd0b0047b84d88131216eb5144f26265275` |

The EVM candidate binds the actual existing verifier manifest hash `32bfe7e88f15926933c14dc2ce838913508fae25a18ed0d5e06ccf9eeb3751eb` and passed two deterministic bundle rebuilds. The Wallet candidate hashes all 28 current verifier inputs; its 181663-byte browser bundle reproduced twice at `308714f5873469d528a49ce1df993fa9e3617ecabc60c7edaca7db063316893a`. Both are source-only proposals. Prior c5ba candidate pairs are rejected and superseded.

`verify-wallet-connect.mjs` still pins the old active `wallet-verifier-manifest.json` and old candidate path. Its tests intentionally fail closed on current changed bytes; no active pin has been updated. Independent review must validate the exact diff, source/bundle relation, candidate identities and fail-closed pin transition before an activation commit. Even then, a local source/build checkpoint would not prove public deployment, real Wallet connection, installed app, real order or trade. All those claims remain false.
