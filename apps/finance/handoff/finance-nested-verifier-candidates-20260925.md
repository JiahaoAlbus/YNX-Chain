# Finance nested verifier candidates — source only

The two P2 reviewer findings against the prior `9204e843` workspace candidate were fixed at `2627b20938828b24dc1cefd8a334668033d7a07e` / tree `321cf666466f7f6a903758810d57d9c8aa398f70`:

1. Budget rows retain the escaped nonempty source `coverage` explanation across a locale switch. The translated fallback appears only if the source omits coverage. No unknown full-period total or return is inferred.
2. A statement is cached only after strict schema/coverage validation and render. An invalid response clears the candidate, shows a localized failure and remains safe across later language changes.

The earlier v7 Wallet verifier candidate is historical and not activatable for this new source. Its old nested EVM candidate likewise remains immutable historical evidence.

New nested EVM candidate: `apps/finance/evidence/evm-read-runtime-verifier-candidate-workspace-2627b209-v5-20260925.json`, 6,059 bytes, SHA-256 `e6740a5312449f9e3d933892e61796dfc509d306e0fb1172bf0676e4f204673d`. It changes exactly three exact inputs from the previous candidate: `web/index.html`, `scripts/finance-nonregressive-runtime.mjs`, and `internal/finance/server.go`. It preserves the two reviewed source/bundle relations and all false public/authorization claims; both EVM bundles rebuilt twice byte-identically.

New outer Wallet verifier candidate: `apps/finance/evidence/wallet-verifier-manifest-workspace-2627b209-v8-20260925.json`, 5,894 bytes, SHA-256 `fc61b774e045dc5cc0d72ac04eea2f89c3df904da697c9d37830c72b78da2fae`. It updates eight current Finance Web file identities, the nested candidate path/bytes/SHA, and the Wallet bundle reproducibility identity. All other file identities and non-file contracts stay fixed. Wallet browser bundle rebuilt twice and matched the committed 182,014 bytes/SHA-256 `c6419bddc26227bf884583a79fa508b33e9321ee45201812263f38c9b455b63c`.

Focused evidence: `node --test apps/finance/tests/workspace-wallet-verifier-candidate.test.mjs apps/finance/tests/workspace-evm-read-candidate.test.mjs` 5/5; `node --test apps/finance/tests/standard-wallet-flow.test.mjs` 27/27; `node --test apps/finance/tests/ai-order-intent-browser.test.mjs` 7/7. The active verifier remains on predecessor SHA-256 `9cbc39d8b9e80345965d6e0b7768bd4c6582bbeff4ef0e8ba2a5224e3d2c46eb`, so full Finance gate still fails closed until independent review and a separate activation commit updates both nested and outer pins without relaxing the tamper guards.

No public deployment or installed Wallet lifecycle has been proven. A Finance-only release lease remains required for source-bound public validation; account/signature/transaction claims remain false.
