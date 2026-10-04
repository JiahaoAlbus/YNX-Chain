# Real Go / real Chrome shared-workspace Paper recovery

Test source `72584f14e062be41f1a5d75420a680efd105dcd7`, tree `7b95ffeacd9c449c9184dde018b9221b9e476aa3`. Runtime business source inherits `a6bcb017dca11dcd932aa6758eb2b0912a70e60f`; Web bytes unchanged from final `f4a3b03559a5948a1ab62508c6bd11307bdd908e`.

Command: `node --test apps/quant-lab/tests/research-recovery-browser.test.mjs`. Final **1 PASS / 0 FAIL / 0 SKIP**, 18962.657625ms (overall 19174.797917ms). Earlier same expanded flow without the final screenshots also PASS at 20261.530792ms. This extends the original complete Go/browser test rather than replacing its risk, tenant, schedule, lost-response, locale, restart or cost assertions.

Three normal browser contexts, including two real tabs in the third context sharing actual browser storage. Original UI creates every strategy and pending journal; no storage injection, synthetic acknowledgement, provider/token/account/grant or callback fabrication. Controlled local market tape only, not public prices. Actual original Go service executes every Paper POST.

Sequence: A submits v1 fee10/slippage5/amount1000000; server commits while HTTP delivery is held. B opens the same workspace, normally confirms and replays the exact same intent/body; the original Go receipt clears that journal. B normally confirms a distinct new request (fee20/slippage10/amount2000000), server commits and its delivery is held. Deliver A's old response: new B journal bytes persist, A memory matches new journal, A's existing form and feedback are not overwritten, and B stays busy. Deliver B's own response: only its journal clears. Both tabs reload and read the same two exact persisted receipts and cash debits. Three POSTs, two distinct intents, two committed orders, no extra charge/reload submission, zero blank tabs and zero page errors. Existing four service SIGTERM/restart gates still pass.

Final retained root: `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-eo32qJ`. Screenshots committed under `paper-two-tab-flow-20261004/`:

- `same-workspace-late-old-response-en.png`: 182648 bytes, SHA256 `e3a14b79cff77ddade6e11b785cab5710576c3db3603fb90d6f2513aacf88a6e`.
- `same-workspace-new-request-pending-en.png`: 193849 bytes, SHA256 `a5c5fa6d2bff6c20f758a65e722dae6d8be83804bcf63424a86c45894871a39a`.
- `same-workspace-two-orders-reloaded-en.png`: 227432 bytes, SHA256 `6bb118eb8ab183b53a6e24925f7b0d60a48284f6732add550ae72f9b771aae83`.

QA Darwin/arm64 binary: 11517090 bytes, SHA256 `48418fe95eb5bed135908c409a16df32e544d39f0703ec0313866f5e23ab41aa`, built by test before commit. Not a formal/source-bound platform release or installer. `publicVerified=false`, `walletApproval=false`, private Product Session/native execution/signature/real transaction gates remain unproven. Formal shared/runtime/install/publication belongs to the existing release owner, not this fixture. Separate real PostgreSQL multi-process cost/tenant/restart proof remains in `paper-cost-postgres-processes-20261004.md`.
