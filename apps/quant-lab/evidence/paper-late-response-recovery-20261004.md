# Exact Paper intent late-response recovery

Source: `a6bcb017dca11dcd932aa6758eb2b0912a70e60f`, tree `4592c1a420a98b67fe8f1c8950521967f47357a5`. Inherits the cost engine/API/UI checkpoints; does not modify the shared SDK, Auth, Host, formal producer or deployment inputs. Local source/QA only, not public/installed acceptance.

Independent audit supplied two executable counterexamples: an old bound success or definitive rejection erased a newer same-workspace durable journal. Original probe retained at `/Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/coordination-01a094cc/recovery-20261004/quant-paper-cost-complete-independent-review/source/apps/quant-lab/tests/independent-paper-late.test.mjs`.

The fix binds removal to original serialized bytes and memory, and response feedback to the original submission lane plus current strategy/side/amount/cost form. Stale success/rejection/network completion neither removes replacement bytes, reports a new operation complete nor starts an old response's follow-up read. Dispatch re-reads durable recovery state and checks it again after confirmation before any persistence/POST. Explicit forgetting checks the same bytes across its confirmation. A daily-loss rejection's asynchronous follow-up read cannot publish old feedback over a new intent. Storage removal failure retains memory and disables workspace writes. Legacy no-cost journals remain unchanged.

Gates on final source:

- Node syntax and `git diff --check`: PASS.
- Business-flow + real Chrome cache-version test: **123 PASS / 0 FAIL / 0 SKIP**, 1342.542458ms.
- Unmodified independent success/rejection probes copied to `/tmp/ynx-quant-independent-late.pPmG29` with final Web files: **2 PASS / 0 FAIL**, 72.268541ms. Only those two exact independent tests selected; no assertion removal.
- Original real Go + two independent headless Chrome contexts + four clean service SIGTERM/restarts: **1 PASS**, 16172.28625ms (overall 16363.871583ms). Controlled local market tape, not real prices/accounts/transactions. Lost Paper response, exact replay/no second cost charge, fee/marked-loss arithmetic, twelve languages, tenant isolation, risk kill and persisted schedules retained.

Final browser artifacts retained at `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-oYmTd7`:

- `paper-costs-recovered-en.png`: 166273 bytes, SHA256 `e2ef1a57600bd0bc684dba70cb254e27ac75c042f2882b8f1c6c1daed41d04fb`.
- `paper-costs-recovered-ar.png`: 139495 bytes, SHA256 `44db702dc3160b93e28eb880b2b84b94dbd73e23912861adb5e6cecc708c4478`.
- Local Darwin/arm64 QA binary: 11517090 bytes, SHA256 `48418fe95eb5bed135908c409a16df32e544d39f0703ec0313866f5e23ab41aa`; built by the original test before commit, NOT a source-bound installer/release binary.

Failure history is not hidden: the first UI guard draft failed the existing durable-removal-failure test because the final journal reload cleared memory when storage was unavailable; fixed by retaining memory in that state. One combined browser run timed out at 45 seconds (retained root `ynx-quant-research-recovery-BhgbkH`); it is not PASS. The next isolated run and the final-source run completed in ~16 seconds. No claim is made that the timeout's exact cause was proven.

Release-owner inputs: `web/app.js` SHA256 `24bb50fe4a2d29253b822c5eaaccc7fe106594da9b162832f737a65c86ef17dc`; `web/index.html` SHA256 `29035c24063f65d9c0998f177e94e2d3e08510a4e14994472fbb84b62bddaa92`. App cache query binds those exact bytes. Adopt with the matching cost-aware backend checkpoint, not an old backend. Separate PostgreSQL process proof is in `paper-cost-postgres-processes-20261004.md`.

Unproven: formal/public runtime source binding, installed package, real Wallet approve/sign/callback, native mandate execution, Product Session v2 and Testnet/real capital trades. Those gates remain false. Formal build/install/publication remains the release owner's surface.
