# Quant research schedule PUT recovery — owner source and isolated runtime

Parent: 107dda6b5a0dd6afc814fa2241437fd2352e9d78. Branch: codex/exchange-sso-cookie-binding-20261002; owner worktree: exchange-sso-cookie-binding-20261002.

## Reproduced business failures

Repeated identical schedule configuration reset NextRunAt, discarded a running claim's RunID and running flag, and overwrote the last completed research receipt. Repeated stop also appended redundant audits. Original Service regression with twelve concurrent calls from two instances failed in all scheduled/running/completed/stopped phases (0.949s package failure). This could prevent an in-flight research worker from completing after a response-loss retry.

Separately, the existing engine emits `stopped_stage_advanced` when a strategy moves beyond Backtest. The UI did not recognize this valid status, showing unknown schedule instead of the actual stop reason. New UI regression failed (64.955334ms total) before correction.

## Original implementation corrected, no new engine or protocol

Under the existing mutex and durable reload/lock, identical enabled interval/assumptions now return a detached copy of the current saved strategy without resetting runtime or writing state/audit. All existing market/stage/parameter validation still precedes this enabled-config no-op. A strategy already stopped by the user with no running/next-run state likewise returns its original detached receipt. Different valid configuration still changes the schedule; invalid interval/cost changes remain rejected without persistence. No request schema, shared SDK, tenant authority, permission, state schema or financial execution capability changed.

The final regression invokes actual HTTP PUTs, twelve concurrently through two independent original servers, across four phases and both filesystem and real PostgreSQL state. It verifies the exact returned run/next-run/history, unchanged durable file bytes or PostgreSQL revision+payload, and cold service reopening. The original running claim must still execute and complete afterward; no Paper/Testnet capital orders are submitted. Local preview headers are fixture-only, not public identity approval. This is current-configuration PUT idempotence, not an eternal idempotency-key ledger: a deliberate stop and later restart is still a new action.

UI recognizes only the additional engine-defined status and provides its stop reason in all twelve supported languages; a Walk-forward strategy does not acquire a restart button. Unknown status remains unconfirmed. The test uses the original controller harness, not a real Wallet or public schedule approval.

## Executed gates and retained failures

- Final schedule targeted race gate with both actual file/PostgreSQL HTTP variants, three repetitions: PASS, 3.019s. This executes 288 identical local HTTP PUTs across the eight phase/storage cases, plus different-config validation.
- Complete `go test -race ./internal/quantlab -count=1` with the existing approved loopback `ynx_quant_qa` database and `YNX_QUANT_POSTGRES_TEST_URL`: PASS, 15.797s. Includes existing independent OS-process Paper/research replay and scheduled-worker SIGKILL recovery. This is declared controlled local market data, not public performance or capital execution.
- Initial PostgreSQL suite invocation used `ynx_quant_qa_20261004`; original child helper requires exact `/ynx_quant_qa`, so three independent-process tests rejected startup and timed out, package FAIL 30.785s. Kept this failure; did not widen helper whitelist. Same-process PostgreSQL gates passed against that separate DB. Corrected only the local test input to the previously retained approved QA DB for the final full pass.
- JS business/records/research-browser gates: 109/109 PASS, 0 skip, 14654.9985ms. Actual original Go + two independent Chrome contexts completed saved research, response loss, explicit recovery and four clean SIGTERM restarts. Its tape is controlled local data.
- `go vet ./internal/quantlab`, gofmt, `node --check apps/quant-lab/web/app.js`, `git diff --check`: PASS.
- PostgreSQL 17.11 retained cluster `/tmp/ynx-finance-postgres-qa.J359YD` reused on 127.0.0.1:64623; checked no other clients, stopped normally after the test. Databases/cluster preserved. Unique test namespaces cleaned by their existing fixtures, not global reset.

Actual-browser retained QA directory: `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-JQZO6y`.

- Local QA binary: 11516674 bytes, SHA256 `703c9c7c33f022af795812b90cc02f836a4fbefac48f96db0aa25cda1dec2f1f`. Built from the then-uncommitted owner candidate; not a signed installer or public source/version binding.
- `workspace-unavailable-en.png`: 208242 bytes, SHA256 `60d29d03efe7f8edc222c9d13c070af1a6f46734d51cf8c5b3de6a76edd0891f`.
- `workspace-recovered-en.png`: 191614 bytes, SHA256 `ddfb02ecc53cda3d91b28811bfc4e52bc7c4709c9d2416e892754734caaaf489`.

## Handoff / remaining delivery gates

No formal manifest/pin/version/bundle was edited. The ordinary app.js change requires the central release owner to assemble a matching protected main/producer/profile/assets graph; do not replace old asset hashes silently. No public deployment, native installation, ComputerControl, real Provider approval/sign/transaction or Product Session lifecycle has been proved by this checkpoint. Original public runtime remains separate and the complete Finance-suite goal is not achieved.

Rollback for future authorized assembly: revert only this checkpoint's owned schedule/UI changes and direct tests, preserving prior Quant snapshot/business receipt isolation and Exchange fixes. No destructive reset, database wipe or forced push. Exact source/evidence and the release dependency are sent only to 接续测试网生态审计工作.
