# Exchange detached account, event and command observations

Inherited clean/pushed checkpoint `0406ceb2a2bc12a644e6602d6c410b5262aba9f4`, tree `66ec26d4ce7f9c608d70c3c924e360487b015039`. Quant and Finance checkpoints are preserved.

## Reproduced ordinary engine defects

Account Snapshot collected copied structs but retained TWAP/Scale child-ID slices and AI context slices. User/market StreamSnapshot and ExecutionEvents copied event structs but retained the original RawMessage bytes. Seven direct Service cases failed against unchanged source: mutation of a returned observation changed cached Exchange state (package 0.653s).

The original command return paths also retained those nested references. Eleven further cases failed (package 1.395s): Scale creation/replay/cancellation/cancel replay; TWAP replay/cancellation/cancel replay after a real controlled TickTWAP child; mass cancellation/replay; AI draft creation/review. These tests invoke existing original native-test signed actions, deterministic local deposit fixtures and original service methods; they are not public Wallet authorization, real deposited funds or real transactions. Initial test compile failed because the fixture named a nonexistent saveLocked method; corrected to the original saveOrRollbackLocked before obtaining the preserved seven red cases.

## Correction

Copy the exact child/context slices and RawMessage bytes at read and command-return boundaries. Preserve nil-versus-empty slice representation with standard slices.Clone. Event payloads are NOT decoded/reencoded: the original key order, exact 9007199254740993 integer bytes, digests, event hashes and ordering remain untouched. StreamSnapshot copies payloads only after selecting the existing last100 range; paged event reads copy only selected events. Account ownership/stream filtering, event sequence, retention, signatures, risk/admission, matching, cancellation, nonce/idempotency, save/rollback, audit and persistent schema are unchanged.

Cancellation responses additionally detach their nested TWAP/Scale returns, including exact original-key recovery. AI deletion's cleared context has no retained mutable slice and retains its existing contract. No SDK, second authorization adapter, shared permission or deployment behavior was introduced.

## Executed tests

- Seven read cases and eleven original command cases now require unchanged cached-state digest and byte-identical persisted file after mutating returned references. Foreign account Snapshot exposes none of the controlled owned TWAP/Scale/AI records. Event test checks original byte sequence/order and integer, not a newly normalized digest.
- Real concurrent JSON encoding of a retained StreamSnapshot against mutex-protected changes to original event payload requires unchanged bytes; race detector PASS.
- Final three target groups `-race -count=3 -timeout=60s`: 57 case executions PASS, package 3.816s. Earlier seven-read target PASS1.705s and combined seven+eleven PASS3.560s preserved.
- Full `go test -race ./internal/exchangeproduct -count=1 -timeout=180s`: final PASS16.748s; earlier whole-package run PASS12.219s before the final concurrent fixture/range-copy optimization.
- `go vet ./internal/exchangeproduct`, gofmt and `git diff --check` PASS.
- Four ordinary UI/controller groups (owned-record-integrity, owned-controls-browser, private-account, account-response-stream): 50 PASS / 1 explicit existing SKIP / 0 FAIL, 14052.824875ms. The skipped controller HTTP/SSO case requires YNX_EXCHANGE_CONTROLLER_HTTP_QA=1 and was not enabled; it is not replaced or relabeled. PostgreSQL opt-in tests were not enabled in this round.

## Fresh read-only public truth

At 2026-10-03T23:59:58.518Z, `https://exchange.ynxweb4.com/api/version`: HTTP200, application/json; charset=utf-8, 107 bytes, SHA256 `b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8`; commit `91c1a40587d28ad4c931d4a4d601766bd467ea20`, version `0.1.0-testnet`.

At 2026-10-03T23:59:58.598Z, `/api/health`: HTTP200, application/json; charset=utf-8, 307 bytes, SHA256 `9d16623ea43cc49bd257b1043c14bd1f1cd1d68a8df4b8e754a1ff2c5dbdc7de`.

These public reads prove the old runtime remains available, NOT deployment of this fix or real account/trading acceptance. No private endpoint, user account, Wallet popup, signing, real transaction, SSH or public mutation was exercised. No fresh PR/CI/installer is claimed.

## Remaining release boundary

Ordinary Exchange-only source checkpoint. A wallet_release_owner still owns exact compatible formal asset graph/build/runtime release and canonical Web business-write producer/profile/mount. Public source identity, genuine Wallet/provider approval, installed-app, private Product Session and actual business acceptance remain open. Historical source/asset failures are preserved. Report exact checkpoint and public mismatch only to `接续测试网生态审计工作`.

Only original Exchange service, new copy helper, direct tests and this evidence change. Shared/Host/Wallet/Finance/Quant/DEX/Card paths remain untouched. Source rollback requires a normal reviewed revert, not reset/force-push or production changes. Whole ecosystem goal remains incomplete.
