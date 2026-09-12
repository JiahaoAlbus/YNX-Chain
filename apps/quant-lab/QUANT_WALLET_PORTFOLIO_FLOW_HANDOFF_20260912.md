# Quant Wallet → Portfolio → Paper flow checkpoint

## Scope and provenance

- Owner branch: `codex/quant-financial-flow-20260912`.
- Isolated worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/08-quant-flow-20260912`.
- Preserved predecessor: `301b680ac8bec297108a75920b1c34354345b574`, tree `9bf449bb52d8d2d1a3c6222da4f4891f7f22e9e0`. The original Quant worktree/branch and its ahead commit are unchanged.
- The initial UI checkpoint is `8c21c0af1b19faf2c873dd360d9090480695159f` / tree `89e4baafe8f26a7aa7f6e9ce74839f384497f3dd`; the tenant/Paper successor is `1e1cb267a7cda33e9a14560e2d6e87ffdd818234` / tree `0efb40b66b10e80fd7e1f5a4b9119884aeb2e5c4`.
- This successor consumes the immutable Wallet-team Standard runtime `c97f85e9ae4d4580b99860c51738e6040ca9ca18` / tree `28a660bbe1451f0d5e20d6eb08da17eef0970d77`. The exact standalone `vendor/standard-wallet-browser-c97f85e9.mjs` is 22,417 bytes / SHA-256 `b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43`; its upstream manifest is preserved alongside. Discovery and `StandardWalletConnection.connect/restore/revoke` come from this runtime, not a product reimplementation. Existing package/lockfile and shared reducer are unchanged. The canonical Quant HTTPS origin is product metadata; the provider still independently scopes actual requesting-origin permissions.
- No protocol, Core or other product changes. The exclusive Quant backend `internal/quantlab` is included in the Paper successor; other internal packages are untouched.

## Implemented product behavior

1. Explicit YNX Wallet or MetaMask selection is persisted as a validated provider kind, never an account or authorization. Guest startup performs no account/chain calls without that preference. Read-only restore selects only that exact provider, using `eth_accounts` and `eth_chainId`; no fallback to the other provider.
2. Disconnect clears the preference and detaches listeners. Discovery, switch, permission and balance responses are revision-fenced. Cancelling an in-flight connection or leaving the page prevents late permission/state changes. Chain `0x1917` is checked again after account approval.
3. Portfolio requests `eth_blockNumber` and `eth_getBalance(account, exactBlock)` from the selected connected Provider. Chain and accounts are re-read before accepting the result. BigInt decimal balances carry account, provider, chain, block and source. No browser direct RPC fetch or fabricated value is used. Account/chain changes clear old balances and pending signing previews/signatures.
4. Paper is explicitly a browser-tenant simulation, distinct from chain balances. Its form selects an existing saved strategy hash instead of the previous all-zero hash. Guest Research/Paper remain available; native Testnet actions still fail closed when their independent authorization is unavailable.
5. New Portfolio/business boundary labels and errors cover the existing 12 locales. This does not certify all legacy fields as fully translated.
6. The Paper HTTP boundary resolves the saved strategy within this tenant under its durable lock. Cross-tenant or stale strategy hashes are rejected before an order. A required 8–128-character idempotency key returns the same persisted Paper order for an identical intent, even with the market offline; changed strategy/side/amount under that key returns HTTP 409. Concurrent first submissions recheck under the same durable lock. The lower-level engine adapter remains separate.
7. The browser persists an unacknowledged Paper intent before sending it, blocks double submission, and restores the exact key/inputs after reload. Unknown network results or unbound response bodies retain the key; a different intent cannot silently replace it. Only an exact returned ID/key/strategy/side/amount clears the pending request. Wallet changes do not move this Paper intent to another tenant.
8. Local Disconnect is explicitly not permission revocation. The separate Revoke wallet access action calls the shared runtime: only an accepted `wallet_revokePermissions` response plus empty `eth_accounts` readback yields `permissionRevoked=true`. Unsupported/rejected/failed/superseded outcomes remain false. Expected empty-account/disconnect events during revoke are distinguished from a newer explicit connect/disconnect intent; an old revoke cannot clear the new connection. Token allowances are never claimed revoked.

## Executed local validation

- `npm test`: 18/18, including nine actual-app VM business-flow regressions.
- `npm run test:wallet-flow`: 16/16 actual local Chrome tests using explicitly injected test providers/accounts/balances and the real bundled SDK. Covers exact selection/restore, disconnect/reload, missing-provider isolation, discovery/switch cancellation, post-approval chain drift, stale-account balance/signature clearing, private/RPC degradation independence, silent empty restore, revoke acknowledgement/readback, unsupported/rejected/failed revoke and supersession by disconnect/provider switch.
- `npm run test:browser`: 4/4 against the actual local Go Quant service: unavailable market fail-close, English guest fallbacks, mobile Arabic RTL width, empty-strategy guard, reconciliation and Paper kill switch.
- `go test -race -count=1 ./internal/quantlab ./apps/quant-lab/server`: PASS. Optional PostgreSQL cases require `YNX_QUANT_POSTGRES_TEST_URL`; no live DB proof is claimed.
- `npm run test:tenant-flow`: actual local Go HTTP integration PASS with two independent tenant IDs, two concurrent Go processes and 12 same-key submissions resulting in exactly one Paper order per tenant. Strategy/experiment/Paper/audit data remain isolated and survive server restart; cross-tenant/stale hashes return 403; changed-body replay returns 409; same-body replay returns the original receipt without accessing an offline market feed. Explicit synthetic loopback market fixtures are not live market evidence. Local filesystem cross-process locks are tested; PostgreSQL multi-instance production readiness remains unproved.
- `npm run verify:canonical-authorize`, JS syntax and `git diff --check`: PASS.
- Generated `web/wallet-auth.js`: 80,342 bytes, SHA-256 `55d9975cdd5cd1b6c22bf6649f11d49cc6e48c02d58fb284d0b8955086badd58`.
- Local-service screenshots: `tmp/quant-lab-evidence/` (ignored test output, not immutable public evidence).

## Actual execution boundaries and next work

- `/api/v1/snapshot` is the current browser tenant's persisted research/Paper workspace, not Wallet-authenticated portfolio data. The 256-bit tenant binding is not a signature or native mandate.
- A Standard EVM `0x` account is not a native `ynx1` mandate authorization. No conversion is treated as authority. Native signing and one-time proof remain unavailable through `YNXQuantWallet.requireProof`.
- The existing Exchange adapter `POST /v1/quant-adapter/account` requires an authenticated private scope and signed native mandate. Order submission additionally requires an exact order signature, idempotency key and risk observations. No production broker/native signing path is synthesized here.
- Paper request contract: `POST /api/v1/paper/orders` with `X-YNX-Tenant-ID`, loopback `X-YNX-Preview-Mode: local-paper`, and JSON `{strategyHash, side, amount, idempotencyKey}`. Response is the exact persisted `PaperOrder` with `IdempotencyKey`. A strategy hash is ownership-checked, not treated as authentication. Old clients without a key fail closed; deploy the matching Web assets and backend together.
- Persistence is backward-readable: `PaperOrder.IdempotencyKey` is `omitempty`, leaving old empty-key JSON/integrity bytes unchanged; no new state map/schema migration. New keyed orders must not be rolled back to a binary that does not preserve the added field without an exact state compatibility plan.
- Current fixture-provided provider values prove implementation behavior only. Real YNX Wallet/MetaMask discovery, account approval/rejection, callback, native install, public source binding, signing, Testnet orders, WalletConnect and all migrated/public/production gates remain **false**.
- Canonical deployment target remains `https://quant.ynxweb4.com/`; this turn did not open, SSH or deploy it. A new source-bound runtime artifact and owner-authorized release/rollback are required. Do not reuse an older candidate archive to represent this source.

## Rollback

Revert this product checkpoint or restore its predecessor via a new non-destructive owner commit. Do not reset the original worktree, overwrite shared package authority, or deploy a rollback without its separate authorization. No runtime/database migration was performed by this checkpoint.

## Frozen source-bound runtime candidate

The final shared-runtime consumer source is `7751882774636db6bdeee059faf66eac40cd1383`, tree `49ceaf7622fe77eea78675decf25cc436eccfcb2`. Evidence is `apps/quant-lab/evidence/wallet-paper-flow-77518827-runtime-candidate-20260912.json` and is intentionally a later evidence-only commit.

Two independent local builds produced byte-identical Linux/amd64 archives: `/tmp/ynx-quant-lab-775188277463-linux-amd64-wallet-paper.tar.gz`, 3,352,196 bytes, SHA-256 `2d07347f1fe99f75cf30a0afd731dedd1da7e3f56204e8a70b487a34a3637189`. The contained `ynx-quantd` was inspected as ELF64 little-endian x86-64, 7,909,560 bytes, SHA-256 `d03c353b896ca6a5468e797a0a729ae454c8a945df045247f44d59471c7ba8c3`. Embedded manifest and SHA256SUMS cover the binary and all nine Web assets.

This is an offline server runtime candidate, not a macOS/Windows/Android installer and not executed Linux/public evidence. It has not been uploaded or deployed. Existing public runtime and rollback bindings must be freshly obtained before a separate release decision. Native actions still require Wallet-owned authorization; this source does not grant them.
