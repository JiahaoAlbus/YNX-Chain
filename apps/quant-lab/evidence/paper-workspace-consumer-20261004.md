# Account-bound Paper workspace consumer — local implementation

Inherited worktree: `quant-paper-workspace-consumer-20261001`; predecessor `823809a61e58717df4d5b0d247ea2a6491d69770`. The two untracked Paper session drafts were preserved and completed, not discarded. Changes are confined to `apps/quant-lab/**`. No Quant engine, shared SDK, registry, auth producer, Host or production file is changed.

The existing official browser Product Session factory owns the separate `quant:paper:workspace` approval and durable restore/revocation. The Paper panel now has real authorize, refresh and revoke actions, and displays only the owner-bound snapshot returned by `/api/v1/wallet/paper/snapshot`. Browser-local simulated Paper remains separate; no legacy tenant ID chooses the native account's workspace. The new panel does not enable backtest submission, Paper signal submission, scheduling or Testnet execution. Existing public research and guest functions remain available.

Real regressions found and corrected in the inherited draft:

- Approval purpose exceeded the shared factory's 180-character limit and failed before invoking Wallet. The description now fits, retaining the simulation/no-real-funds/no-Testnet/no-scheduling boundary.
- POST body could be changed while a fresh session proof was pending. Exact string bytes are captured before asynchronous proof creation; invalid/oversized input is rejected before HTTP.
- Response size was checked only after `text()` retained the entire body. The reader now bounds streamed bytes to 2 MiB, cancels oversized/invalid UTF-8 bodies, and rejects non-record snapshot structures.
- Refresh previously emitted an event with no actual reader. It now calls the existing owner-bound API; authorize reads after separate approval. Revoke clears rendered values without disconnecting Standard Wallet.

Executed local gates:

```
node --test apps/quant-lab/tests/paper-session.test.mjs apps/quant-lab/tests/paper-session-browser.test.mjs
node --test --test-concurrency=2 apps/quant-lab/tests/*.test.mjs
npm run build:wallet                         # apps/quant-lab
node apps/quant-lab/scripts/verify-versioned-assets.mjs
go test ./apps/quant-lab/server
git diff --check
```

Focused: 6 PASS, 0 FAIL (2253.623375 ms). Full current worktree test glob: 69 total, 68 PASS, 0 FAIL, 1 explicit skip (60902.509 ms). The skip requires a real matching Hosted Wallet dist; it was not replaced by a fake installed Wallet. Server package PASS (0.317 s). Versioned asset gate: four exact bindings PASS. Wallet bundle build PASS; final bundle SHA256 `2b8c4e9e6ea01f8f0e2e7d38b9c6f08b7dbbc64f2b528ef003489e21f87309c0`.

The new browser test executes actual Chrome, official SDK/WebCrypto/IndexedDB and official local Gateway kernel. Its approval key, selected provider and API snapshots are controlled fixtures. It covers separate scope, no action at guest startup, all twelve product locales, approve/reject, read/refresh, reload without re-sign, confirmed revoke, preserved Standard connection and stable one-tab URL. Unit regressions execute the actual module and cover delayed proof/revoke, owner mismatch, service degradation, immutable request bytes, oversized stream cancellation and unsupported operation refusal.

Truth: source implemented/tested; deployedPublic=false; installed=false; realProviderApproval=false; realProductSession=false; realPaperEngineBrowserFlow=false; realOrder/realFunds/Testnet/scheduling=false. A remains the sole formal Host publisher; earlier remote upload UNKNOWN is not resolved by these tests. No SSH, deployment, real account approval, signature or financial operation was performed. Next owned work: connect the existing separately approved backtest/signal forms to this workspace with preview/idempotent recovery, preserving the independent browser-local legacy workspace and real engine semantics; then freeze the compatible full runtime for A and test real released Wallet/business flows when available.
