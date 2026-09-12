# Quant Wallet → Portfolio → Paper flow checkpoint

## Scope and provenance

- Owner branch: `codex/quant-financial-flow-20260912`.
- Isolated worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/08-quant-flow-20260912`.
- Preserved predecessor: `301b680ac8bec297108a75920b1c34354345b574`, tree `9bf449bb52d8d2d1a3c6222da4f4891f7f22e9e0`. The original Quant worktree/branch and its ahead commit are unchanged.
- Shared Wallet package and lockfile are unchanged. This consumes the existing provider discovery, safe Web launcher and Standard Wallet reducer. No new protocol, SDK, Core or other product changes. The exclusive Quant backend `internal/quantlab` is included in the Paper successor; other internal packages are untouched.

## Implemented product behavior

1. Explicit YNX Wallet or MetaMask selection is persisted as a validated provider kind, never an account or authorization. Guest startup performs no account/chain calls without that preference. Read-only restore selects only that exact provider, using `eth_accounts` and `eth_chainId`; no fallback to the other provider.
2. Disconnect clears the preference and detaches listeners. Discovery, switch, permission and balance responses are revision-fenced. Cancelling an in-flight connection or leaving the page prevents late permission/state changes. Chain `0x1917` is checked again after account approval.
3. Portfolio requests `eth_blockNumber` and `eth_getBalance(account, exactBlock)` from the selected connected Provider. Chain and accounts are re-read before accepting the result. BigInt decimal balances carry account, provider, chain, block and source. No browser direct RPC fetch or fabricated value is used. Account/chain changes clear old balances and pending signing previews/signatures.
4. Paper is explicitly a browser-tenant simulation, distinct from chain balances. Its form selects an existing saved strategy hash instead of the previous all-zero hash. Guest Research/Paper remain available; native Testnet actions still fail closed when their independent authorization is unavailable.
5. New Portfolio/business boundary labels and errors cover the existing 12 locales. This does not certify all legacy fields as fully translated.
6. The Paper HTTP boundary resolves the saved strategy within this tenant under its durable lock. Cross-tenant or stale strategy hashes are rejected before an order. A required 8–128-character idempotency key returns the same persisted Paper order for an identical intent, even with the market offline; changed strategy/side/amount under that key returns HTTP 409. Concurrent first submissions recheck under the same durable lock. The lower-level engine adapter remains separate.
7. The browser persists an unacknowledged Paper intent before sending it, blocks double submission, and restores the exact key/inputs after reload. Unknown network results or unbound response bodies retain the key; a different intent cannot silently replace it. Only an exact returned ID/key/strategy/side/amount clears the pending request. Wallet changes do not move this Paper intent to another tenant.

## Executed local validation

- `npm test`: 18/18, including nine actual-app VM business-flow regressions.
- `npm run test:wallet-flow`: 7/7 actual local Chrome tests using explicitly injected test providers/accounts/balances and the real bundled SDK. Covers exact selection/restore, disconnect/reload, missing-provider isolation, discovery/switch cancellation, post-approval chain drift, stale-account balance/signature clearing, private/RPC degradation independence.
- `npm run test:browser`: 4/4 against the actual local Go Quant service: unavailable market fail-close, English guest fallbacks, mobile Arabic RTL width, empty-strategy guard, reconciliation and Paper kill switch.
- `go test -race -count=1 ./internal/quantlab ./apps/quant-lab/server`: PASS. Optional PostgreSQL cases require `YNX_QUANT_POSTGRES_TEST_URL`; no live DB proof is claimed.
- `npm run test:tenant-flow`: actual local Go HTTP integration PASS with two independent tenant IDs, two concurrent Go processes and 12 same-key submissions resulting in exactly one Paper order per tenant. Strategy/experiment/Paper/audit data remain isolated and survive server restart; cross-tenant/stale hashes return 403; changed-body replay returns 409; same-body replay returns the original receipt without accessing an offline market feed. Explicit synthetic loopback market fixtures are not live market evidence. Local filesystem cross-process locks are tested; PostgreSQL multi-instance production readiness remains unproved.
- `npm run verify:canonical-authorize`, JS syntax and `git diff --check`: PASS.
- Generated `web/wallet-auth.js`: 78,303 bytes, SHA-256 `4ee064d2077081e507bdcd1b5f31027aae39ff112667fab379d584bbc069a4cf`.
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
