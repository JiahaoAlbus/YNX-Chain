# Card MetaMask standard EVM deployment - 2026-08-21

## Source and scope

- Source commit: `8af90ce4af5601378bfb7a695e6cfe30c9311953`
- Branch: `codex/p0-card-metamask-eip6963-20260821`
- Owner scope: `apps/card/**` only.
- The deployment input was a mode `0700`, clean clone at the exact source
  commit. It used `jiahaoalbus-projects/ynx-card-testnet-simulation`, not the
  unrelated `jiahaoalbus-projects/card` project.

## MetaMask behavior

- EIP-6963 discovery accepts an announcement only when
  `providerInfo.rdns === "io.metamask"` and the provider is explicitly
  MetaMask. The injected-provider fallback accepts only one provider with
  `isMetaMask === true`; arbitrary EIP-1193 providers and ambiguous candidates
  fail closed.
- Connection calls `eth_requestAccounts`, then verifies YNX Testnet `0x1917`.
  It requests `wallet_switchEthereumChain`, uses `wallet_addEthereumChain` only
  for `4902`, and verifies the resulting chain again.
- `accountsChanged`, `chainChanged`, and `disconnect` clear or update the
  standard-wallet state. On mobile return/foreground, the app re-discovers
  MetaMask and restores only `eth_accounts` already authorized on `0x1917`.
- Desktop fallback actions are the official install URL
  `https://metamask.io/download/` and the official Card Dapp URL
  `https://metamask.app.link/dapp/card.ynxweb4.com`. The mobile MetaMask action
  opens that same official Dapp URL rather than manufacturing an account.
- MetaMask code is isolated from the YNX Wallet canonical authorization path.
  Tests scan the MetaMask UI/handler source for `ynxwallet://authorize` and
  reject any occurrence. The separate YNX button retains its canonical request
  path.

## Verification

```text
npm ci
npm test            # 31 passed, 0 failed
npm run typecheck   # passed
npm run build:web   # passed
```

The focused tests cover EIP-6963 discovery, injected fallback ambiguity,
missing provider, `4001` rejection, switch/add chain behavior, restored
accounts, account/chain/disconnect events, official mobile/desktop links, and
YNX deep-link isolation.

## Production deployment

- Deployment ID: `dpl_CiW69BfcRsNurrv1cXxd267xi2NX`
- Deployment URL:
  `https://ynx-card-testnet-simulation-juc2mslz3-jiahaoalbus-projects.vercel.app`
- Canonical URL: `https://card.ynxweb4.com/`
- Vercel readback: `Ready`, `production`, with the canonical alias present.
- Canonical HTTP: `200`, `1505` bytes,
  SHA-256 `e9ba9c8d50bda991ca748fec0bc2f6dbbf66942bdc03cc50bf7646065f5071d7`.

## Visible browser evidence

- The canonical guest page displayed the six public sections, Testnet/Sandbox
  boundary, MetaMask fox, **Use MetaMask**, **Install MetaMask**, and **Open in
  MetaMask** while no account was connected.
- Clicking **Use MetaMask** in a browser without its extension produced the
  safe missing-provider message, not a connected account or signature.
- Clicking **Connect YNX Wallet** produced the separate canonical-authorization
  notice. It did not report a MetaMask account or transaction.
- `card-production-8af90ce4-metamask-actions.png` records the browser-visible
  MetaMask missing-provider state. SHA-256:
  `c8e7fc210f12db3bb0bece216c91cf361354262abdfc522093a0cea9f4663a58`.
- `card-production-8af90ce4-metamask-desktop.png` records the canonical guest
  surface. SHA-256: `0777a5395d396a817d33e0138db62ef20eb34e2575e488418ec89396e18b2b85`.

## Truth gates and rollback

- `realMetaMaskAccount=false`
- `realSignature=false`
- `realYNXTTransfer=false`
- `cardApiAcceptedSpendableBalance=false`
- `realCard=false`
- `PANOrCVV=false`
- `fiat=false`
- `realMerchantPayment=false`
- `migrated-v2=false`

Rollback is the existing Ready deployment
`dpl_AuX6P3YTkfKjFR5jCaSW3K6e6y7c` in the same Vercel project (or the older
approved rollback deployment `dpl_8NxK9gwDyirv7hQQwJkRZ68p7r5k`). Promote or
redeploy it, then read back the canonical alias and HTTP evidence. This record
does not perform a rollback.
