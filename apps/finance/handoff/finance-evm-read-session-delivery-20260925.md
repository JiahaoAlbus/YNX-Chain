# Finance EVM read-session owner handoff (2026-09-25)

Status: source and clean-extraction engineering gate passed; public/installed/real-provider gate remains **false**. This card is not a release approval.

## Exact source and review boundary

- Owner branch: `codex/finance-evm-read-session-pr193-20260924`; [PR #196](https://github.com/JiahaoAlbus/YNX-Chain/pull/196).
- Reviewed source checkpoint: `8b95488f32e2d73d320e8adec1040f45d61dc3ac`, tree `4e85c727dbfcbb0d8f69884be3659ef8aef2c114`, remote-readable and clean before this handoff.
- Finance EVM read candidate: `apps/finance/evidence/evm-read-runtime-verifier-candidate-pr199-v2-20260925.json`, blob `f889a4dec0b126d5f1d88ac2ac9510db3059a34a`, SHA-256 `69a425d8c0340e411454a466aa78a34749b1beb5976d9df7520b6d1c84c62353`.
- Finance Wallet verifier manifest: `apps/finance/web/wallet-verifier-manifest.json`, blob `44235c778821c95a844c27afd8830587e75c7372`, SHA-256 `32bfe7e88f15926933c14dc2ce838913508fae25a18ed0d5e06ccf9eeb3751eb`.
- Wallet/Auth subtree at PR199, PR203, and PR204 is the same tree `4d46b06f77667715c1dbd96c89787fdd42d0dd8e`; a later source-input change requires a new candidate and independent review.
- Independent bounded review on the exact PR196 checkpoint passed in a clean Git archive (`/tmp/ynx-finance-final-pin.j5TIv8`): offline installs, exact 16 Finance inputs, locked dependencies, 79 browser and 79 Node graph inputs, two byte-identical builds per graph, full Finance 123/123, and candidate/transitive/re-pin/graph-count tamper fail-closed checks. This is local engineering evidence, not installed or public proof.
- Finance owner verification also passed: focused 17/17, full Node 123/123, `node apps/finance/web/verify-wallet-connect.mjs`, opaque candidate local verification, and security scan across 331 text files. The Standard Wallet browser bundle remains 181400 bytes, SHA-256 `e04e757f20ff98ef3bbd97ac294c1e6c022c6e93edd1c441e30ac03c1959ed1b`.

## Shipped behavior and limits

- Finance keeps guest catalog/workbench usable and Standard Wallet separate from optional private Product Session failure. The EVM read session is a bounded server-verified observation (last verification at most five minutes old), **not** live extension state attestation; `extensionLiveStateAttested` remains false.
- Broker order paths retain explicit Wallet approval, owner mapping, durable idempotency/concurrency/recovery, and no browser-side provider write. AI output is draft-only. Tests and local Chromium fixtures do not prove an official Alpaca Sandbox account, real order, YNX/MetaMask approval, or Testnet transaction.
- The public `https://finance.ynxweb4.com/version` was read on 2026-09-25 and still returned source `c20709da38bc2a4823efb9870046b6afb7775992`, release `finance-weekly-v3-c20709da38bc-linux-amd64`; this is **not** source-bound to this PR. No Finance deployment or installed build was performed in this checkpoint.
- PR #196 currently has a failing `wallet-ios/simulator-build` check because `apps/wallet/scripts/sbom-check.mjs` reports a stale committed Wallet SBOM. It is outside Finance ownership; do not rewrite Wallet files in this branch. Finance 123/123 is separately green.

## Release and rollback boundary

An immutable Linux amd64 candidate is now frozen from the reviewed exact source: `apps/finance/evidence/release-candidates/finance-weekly-v3-8b95488f32e2-linux-amd64.tar.gz`, 30,850,090 bytes, SHA-256 `6d64ce0b6046440094ea6468ef39a6b3f0e3d0a41f1190c53d77d1cbb1e6311f`. Its 37-file inventory, local Linux cold starts, and release/rollback preflight are in `apps/finance/handoff/finance-evm-read-linux-amd64-candidate-20260925.md`. **No single-use production lease exists for this candidate.** Before any release, re-read Finance host release link/env/unit/Caddy/state/service and public endpoint hashes, then obtain the Central Finance-only deployment lease. The candidate hash is not a public runtime receipt.

If the candidate is not deployed, leaving the current public release in place is the runtime rollback. Any source reversal should be a new reviewable commit on the Finance branch, not a force-push or destructive reset. If a future authorized deployment occurs, use only its signed rollback-first contract and fresh old-release/env/state receipts; after traffic resumes, obtain a separate authorization for any manual rollback and preserve post-deploy state rather than restoring an old snapshot over accepted writes. The historical `c20709da` release card is context, not a reusable lease or current-host rollback command.

## External blockers and next action

1. Wallet Owner/CI: Wallet PR203 has a clean/pushed SBOM fix, but PR #196 has a different stacked base and remains failing until ordered integration. Finance must not copy or mutate Wallet authority files.
2. Release Control Plane: review the frozen source-bound Finance artifact and issue a fresh, single-use Finance-only deployment lease after exact live preflight; no legacy lease may be reused.
3. Runtime acceptance: deploy exact artifact, verify public `/version`, `/health`, HTML/assets and rollback identity, then personally inspect the public UI. Real selected-provider approval/rejection, 0x1917 readback, chooser close, refresh/events/disconnect, Product Session degradation independence, and installed-platform claims remain false until direct evidence exists.
4. Official Alpaca credentials/entitlements, official Sandbox order execution, mainnet custody, production signing, and actual chain transaction are not established by this source checkpoint.

Send any new issue or unmet gate to `接续测试网生态审计工作` (task `01a094cc-0ba3-7901-bcd5-56fce8330c0d`), not the prior audit task.
