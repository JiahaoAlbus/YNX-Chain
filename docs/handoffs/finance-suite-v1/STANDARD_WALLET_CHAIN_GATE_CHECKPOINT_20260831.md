# Finance-suite Standard Wallet chain gate checkpoint — 2026-08-31

This handoff covers only source/test checkpoints. It does not alter the global product registry, Wallet/Auth protocol, website navigation, public deployment, or any Central path lock.

## Owner checkpoints

| Product | Owner branch | Source checkpoint | Local transport artifact | Focused evidence | Public/installed evidence |
| --- | --- | --- | --- | --- | --- |
| Finance | `codex/final-finance-suite` | `961758a8df350a176d36177552042f06addbf7af` | `/tmp/ynx-finance-961758a8d.bundle` — SHA-256 `79a65aa198fe1b509cf6decb3af73196643ea67967966f6ccbf50ccf0d673569` — requires `0892cd45037dd158e92c041643e3352393fe85c4` | `npm test` 20/20; `npm run security` 280 files | false |
| Exchange | `codex/exchange-a9-runtime-carrier-20260831` | `1b263be6ed29341046f78657f6587afa13f3b629` | `/tmp/ynx-exchange-1b263be6e.bundle` — SHA-256 `da68ee78cfb4abc4dfd7d4e258639c4ffa3ffaf43a863a0835bc0f0f2e95b4a5` — requires `7f4395f84ccd730bc520ed9b297e7c3956b9d341` | `npm test` 14/14; `npm run test:browser` 3/3; `verify:wallet-connect` pass | false |
| Quant | `codex/quant-owner-contract-snapshot` | `3bcf54ad78bec3b65b331f88d3fee93da05bd37f` | `/tmp/ynx-quant-3bcf54ad7.bundle` — SHA-256 `1347661017360b8545ab2711149529039e73f6460a2953ea2570a03a07aed8b8` — requires `595e73f8ba4fecbabf3f192e89b4ab86d2b3168e` | `npm test` 7/7; `npm run test:browser` 4/4; canonical-authorize verification pass | false |

## Uniform source behavior

All three checkpoints apply the user-initiated provider-only sequence below before a Wallet can be asked for an account:

1. `wallet_switchEthereumChain` for `0x1917`.
2. On exactly EIP-1193 error `4902`, add the fixed YNX Testnet configuration, then switch again.
3. Read `eth_chainId` and require `0x1917`.
4. Only then may the product call `eth_requestAccounts`.

An off-chain provider fails closed without an account request. Standard Wallet remains separate from Product Session/API degradation. The implementations do not use top-level `ynxwallet://` navigation, `window.open`, iframe launchers, or browser RPC fetch as a connection prerequisite.

## Central integration actions

1. Read each bundle with its stated prerequisite ref and publish with a normal force-false fast-forward when Git transport is available.
2. Bind a separate immutable runtime artifact, public target, rollback point, and one-product lease before any deployment.
3. Verify source-bound public bytes and direct non-sensitive provider lifecycle separately for each product. Do not promote source tests or no-provider browser checks to approval/callback/signing/transaction proof.

## DEX boundary

DEX must not be included in this source checkpoint. Central acceptance `dex-c7-shared-release-binding-no-go-20260831.json` requires a coherent four-path release binding before artifact verification or deployment.

There is an explicit source-selection boundary: independent DEX branch `codex/dex-c7-four-path-manifest-20260831` at `e752a9cc190fcbd5e4bd7f3799dc9b2645a1154f` replaces the older Finance-suite `apps/dex/src/wallet.ts` Gateway/Product Session direct implementation with provider-only, shared reducer code. The product files differ materially, so Central must first bind that DEX branch and its complete C7 release tuple; this Finance-suite branch must not copy or reconcile it. That independent worktree has unrelated dirty artifact deletions and is intentionally untouched. Strategy Vault v1.35 execution remains fail closed until product-owned evidence binds the accepted Chain Core contract; no swap, liquidity, approval, or Testnet transaction is claimed here.
