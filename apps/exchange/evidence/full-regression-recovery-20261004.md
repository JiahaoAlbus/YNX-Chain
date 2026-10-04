# Exchange complete local regression recovery

Runtime source remains `6f62e7e5ebc341bae572fc44f1b844695f3f2399`, tree `7bee8faf19c649775cc0ca644bdf3f846bc0bcd2`; inherited evidence head `8c6a7e0aef52019bc64886f9fde25c0e7ac0fc6f`. This successor changes only historical-custody tests and this record. It does not change the runtime candidate or rebuild shared SDKs.

Historical `market-consumer-inputs-20261004.json` remains byte-unchanged. Its old source, tree, objects, ordinary-hunk ancestry, independent runtime checkpoint and false release claims are checked against exact Git objects rather than incorrectly requiring the current working tree to equal the historical tree. Every object still requires exact blob, bytes and SHA; current asset inventory independently validates the current runtime graph. Negative tests reject source/tree/object/hash/byte/path/diff-command/permission/release promotion tampering. Historical blockers describe historical observations, not a fresh public-runtime diagnosis.

Executed:

- Historical custody + current asset graph: 4/4 PASS, 460.36925 ms.
- `npm test --prefix apps/exchange`: 116 total, 115 PASS, 0 FAIL, 1 optional HTTP QA skip, 3060.914875 ms.
- `npm run test:browser --prefix apps/exchange`: 34/34 PASS, 31081.523375 ms.
- `node --test --test-concurrency=2 apps/exchange/tests/*.test.mjs`: 209 total, 207 PASS, 0 FAIL, 2 conditional skips, 51178.000084 ms. This covers all test files, not only the package's selected list. Unique controlled screenshot directory `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-ui-product-0AQaaP`; candle captures `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-candle-display-ehcDGN`. Historic committed screenshots were not overwritten.
- `go test -race ./internal/exchangeproduct/... ./apps/exchange/server/...`: PASS, 19.590 s and 1.507 s.
- Subsequently enabled the safe isolated HTTP QA: `YNX_EXCHANGE_CONTROLLER_HTTP_QA=1 node --test --test-name-pattern='actual Chromium controller' apps/exchange/tests/private-account.test.mjs`: 1/1 PASS, 6363.9625 ms. Actual Chromium controller and local Go HTTP test service exercise host-only cookie forwarding, two controlled owners, identity change/reload and linked logout. Controlled proof orchestration is not a real user's approval or canonical public-session proof.
- `git diff --check`: PASS.

The remaining unrun conditional test needs `YNX_EXCHANGE_HOSTED_WALLET_DIST`; no unrelated Wallet build was fabricated or substituted. Public/installed product, actual account approval, signatures, transactions and user acceptance remain unproven. The source-bound candidate is preserved at `/tmp/ynx-exchange-identity-6f62e7e5e-linux-amd64.tar.gz`, SHA-256 `28aaa919633dcc8d6401c772a63430aa546b63c83e8df272195b6ae3ea0d31dd`, 4719699 bytes. Formal Host publication remains with A, and previous remote UNKNOWN upload must be resolved without blind retransmission.

Reporting destination per user: 接续测试网生态审计工作 (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`). The send interface twice returned `Cannot steer conversation ... without an active turn id`; delivery is not claimed. This durable owner record preserves the exact completed work and publication dependency for the existing coordinator.
