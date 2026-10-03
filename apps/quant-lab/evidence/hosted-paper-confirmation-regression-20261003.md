# Hosted / native-records / local Paper cross-service regression

Owner predecessor a87f48f59686fe2da6e4ca00a79deec5771e7c75.
Classification: actual local Chrome + Gateway + Go service fixture, NOT public
release, real Testnet execution, native installer or canonical current producer
acceptance. No shared Wallet/SDK sources, production or formal graph modified.

## Executed rather than skipped

```
YNX_QUANT_HOSTED_WALLET_DIST=/Users/huangjiahao/.codex/worktrees/wallet-public-channel-20261001/apps/wallet-web/dist/hosted node --test apps/quant-lab/tests/hosted-native-cross-service.test.mjs
```

Read-only existing Wallet checkout HEAD was
`3e701f6590babd79b995a023a488a408989b877b`; generated dist identity is separately
bound below, not assumed equal to its checkout HEAD. No Wallet rebuild occurred.

Inputs SHA256:

- Hosted app.js `3749e835072b126154e92e924698dfd66a39c174cc8f2e6e9c8c838c5d9fde9b`
- Hosted index.html `bf08c903e365a59fda4945245d06f05ed76778fad0df236c5aeb9db69e15cb1c`
- Quant app.js `0dd3178ec39d9a2b9d13d24f917e2e2df509eccb04df4ccc6cbc21d7c33281ce`
- Quant wallet-auth.js `3b8c2afa35f3af7e1810c4101af8457277dc603960526ee1f6b10f80aaec1ac0`
- Gateway NodeHost source `2897c9543ea093425af09bc37e2b957070f4100b8b2815e418a4b3668f03ddcc`

First execution: 1 FAIL, 0 SKIP, 13.636s. Actual records approve/reject,
read/close/restart/reload, two profiles/account switch/revoke completed, but the
final Paper click produced no HTTP order. Playwright automatically dismissed
the product's explicit confirmation; the old fixture never handled it. Product
confirmation and permission guards were preserved, not weakened.

Changed only the owned fixture: cancellation validates the selected hash and
cost/slippage warning and proves zero Paper POSTs; separate explicit confirm
allows exactly one 201 POST; reload restores real local service order/audit and
does not issue another POST. This is the existing local-preview capability,
not a grant derived from private-records consent. The seed still uses controlled
market/mandate/broker doubles: no capital or public execution claim.

Final actual combined execution: 1 PASS, 0 FAIL, 0 SKIP, 6.898s (total7.122s).
The opt-in Go bridge thus ran instead of its default no-Gateway skip. Retained
ordinary business suite 53/53 PASS; Node syntax and diff whitespace PASS.

The isolated vaults and local Gateway use test-created accounts and no user
private key. No secrets, token proofs or Pair URI were output. This local proof
does not replace each source-bound public/native provider approval, current
joint producer/reader, WalletConnect relay or installed-platform acceptance.
