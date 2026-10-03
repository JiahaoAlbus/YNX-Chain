# Quant detached owned snapshot observation

Predecessor: `6476ba3afacd680c4f59bcb33426be8812c6cd6c`, tree `9922af6921c5067150e5acbdd80a74505dad6438`. Existing Finance fix and all other product paths are preserved.

## Confirmed source defect

`snapshotWithFingerprint` held the service mutex while composing the response but returned original state maps, slices and Paper daily-risk pointer. HTTP/SSE encoding takes place after that lock is released. A direct Go caller mutating the returned snapshot could change cached service state; a future locked update could also overlap encoding of the retained observation. This is an ordinary Go return/serialization ownership defect, not evidence of a remotely exploited permission boundary, public data leak or real order execution.

The new original-Service test seeds a persisted controlled research observation and Paper/dataset/sequence/ledger records, then changes the public return's nested references. It failed against unchanged source: `snapshot caller mutated the retained service state`, package 0.854s. No authority or Wallet capability is supplied by this test.

## Correction

Only public fields are copied through typed state JSON under the original service lock, matching the existing research-receipt copy technique. This detaches nested maps/slices/pointers while preserving int64 types (the test asserts 9007199254740993 exactly). Testnet order Wallet signatures are stripped before the public copy. Private mandates/idempotency/SSO records are not included. No stored schema, original fingerprint, risk/admission, scheduler, adapter, storage write, permission or endpoint is changed.

If copying fails, the response returns no partial public state and explicitly reports `snapshot_copy_failed` plus unavailable source metadata. The existing browser failure lane rejects such a response without replacing its last verified view or enabling fresh Paper intent. A malformed year-10000 controlled in-memory timestamp tests the copy-failure branch; it is not a production observation.

## Actual verification

- New direct mutation regression PASS; changing Paper order/daily risk, strategy parameters, experiment curve/formulas/attribution, datasets, adapter sequences, ledger and audit does not affect original cached state. The next read retains the original experiment and durable fingerprint. Public Testnet signature remains empty.
- Concurrent test runs real JSON encoding of a retained snapshot against mutex-protected nested service updates, requiring byte-identical observation; race detector PASS.
- Final four Snapshot targets with `-race -count=3 -timeout=60s -v`: 12/12 executions PASS, package 1.448s.
- Full `go test -race ./internal/quantlab -count=1 -timeout=180s`: PASS 4.187s after the final copy-failure regression (earlier full race PASS 6.721s). PostgreSQL opt-in tests were not enabled; these runs do not substitute for PostgreSQL multi-process or public runtime evidence.
- `go vet ./internal/quantlab`, gofmt and `git diff --check`: PASS.
- `node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/financial-brand-browser.test.mjs`: 104/104 PASS, zero failures/skips, 6669.81675ms. Browser sizing checks execute controlled local HTML, not public/installed Wallet acceptance.

## Remaining gates / handoff

Normal source-only Quant checkpoint. No formal build/pin changes, downloaded installers, real approved account/signature/EIP712/order/transaction, SSH, public deployment, Host writes or ComputerControl occurred. Formal compatible release remains A wallet_release_owner's scope; source-bound public and native product workflows remain unverified. Existing historical asset-pin failures are not rewritten or relabeled. Shared dependencies and defects are reported only to the authorized coordinator `接续测试网生态审计工作`.

This does not claim that all other return-value boundaries or the whole Quant goal are complete. Continue owned business closure and the coordinated real release/acceptance path. Any source rollback is a normal reviewed revert, not reset/force-push or production mutation.
