# Finance Standard Wallet pending-API UI handoff — 2026-08-31

Status: source-tested only. This document does not claim a public deployment,
Wallet approval, account signature, Product Session, private Finance API,
transaction, or installed-app result.

## Contract

When the accepted Standard Wallet adapter has a selected EIP-1193 account on
YNX Testnet (`0x1917`) but the accepted Finance endpoint manifest retains
`productApi: "PENDING"`, the Web client must show a distinct connected,
no-data state instead of leaving the user at the signed-out landing page.

The state discloses the selected account and chain only. It does **not** fetch
or render portfolio, activity, Pay, budget, statement, AI, or Product Session
data. Its only network read is the existing same-origin `GET /health` check;
that check is never a browser RPC prerequisite. A failed private-service or
health check preserves the Standard Wallet connection and offers the existing
reconnect control. Sign-out remains a local adapter disconnect.

The adapter restores a previously approved connection only with provider
`eth_accounts` plus `eth_chainId == 0x1917`; it never reopens an authorization
prompt during refresh. It listens to standard EIP-1193 `accountsChanged`,
`chainChanged`, and `disconnect` events. An empty account, provider loss, or
wrong-chain event clears the standard connection; an approved account change
refreshes the displayed account after chain verification. These events do not
create a Product Session or make the pending Finance API available.

## Owner source paths

- `apps/finance/web/index.html`
- `apps/finance/web/app.js`
- `apps/finance/web/styles.css`
- `apps/finance/tests/contracts.test.mjs`

## Integration requirements

Before Central enables the Finance product API, it must supply an accepted
endpoint-manifest state and source-bound Finance runtime. The Web client must
not be patched to use a custom gateway URL, direct browser RPC probe, local
session, or unreviewed callback to bypass that binding.

Public or installed evidence still requires a product-specific deployment
lease, exact version/readback identity, and direct user-controlled provider
approval/reject/callback lifecycle evidence. All those gates remain false at
this checkpoint.

## Native pending-API boundary

`apps/finance/mobile/App.tsx` consumes the same bundled endpoint manifest. If
the connected Wallet is valid but Finance remains `PENDING`, it renders only a
selected-account/chain confirmation and explicit reconnect/sign-out controls.
The API client is not constructed, the data-workspace navigation is hidden,
and cached data is not presented as current. Android and iOS JavaScript export
passed locally; this is a bundle-build result, not an APK/AAB/IPA installation
or distribution claim.
