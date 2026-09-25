# Card YNX Wallet launcher production repair - 2026-08-21

## Source and deployment

- Source commit: `2049971bcef179d0fd60d9b75c33bdd6cd2d10c5`
- Branch: `codex/p0-card-ynx-launcher-20260821`
- Deployment ID: `dpl_FmdyweTksT9XpDBeKGE43DZ5NUJA`
- Deployment URL:
  `https://ynx-card-testnet-simulation-aujl3m70t-jiahaoalbus-projects.vercel.app`
- Canonical URL: `https://card.ynxweb4.com/`
- Vercel readback: `Ready`, target `production`, canonical alias present.
- Canonical HTTP: `200`, `1505` bytes,
  SHA-256 `2dcf8f9a7aacaba108a981a3c0cafdb394d1af74f592783606afcbae5e186e5e`.

## Repair

- Web no longer calls `Linking.openURL(walletDeepLink(...))` for the YNX Wallet
  authorization request and never assigns the custom scheme to the top-level
  Card page.
- The launcher accepts only `ynxwallet://authorize?request=<nonempty>` canonical
  requests, creates a hidden iframe, and cleans it on visibility/pagehide,
  timeout, or a repeated click.
- If no registered Wallet handler takes the request before timeout, the current
  Card page remains visible and provides **Retry YNX Wallet**, **Download YNX
  Wallet** (`https://wallet.ynxweb4.com/`), and **Use MetaMask**. No Card
  session, account, approval, or transaction is created.
- The canonical pending request is persisted before launching and reused while
  it remains valid. A real Wallet callback remains governed by the existing
  strict callback verifier.
- MetaMask remains isolated from the YNX custom scheme.

## Verification

```text
npm ci
npm test            # 35 passed, 0 failed
npm run typecheck   # passed
npm run build:web   # passed
```

New unit coverage proves a no-handler timeout preserves the Card top-level URL,
visibility handoff cleans the iframe, retries clean a prior attempt, incomplete
canonical payloads fail, the YNX fallback contains the real download URL, and
MetaMask code does not contain the YNX authorization scheme.

## Real Chrome evidence

On the canonical production page, an actual **Connect YNX Wallet** click tried
the complete canonical request. The browser had no registered handler. Chrome
reported that the embedded custom-scheme content could not be accessed, but the
top-level tab remained `https://card.ynxweb4.com/` and the visible Card page
showed the timeout fallback notice plus **Retry YNX Wallet**, download, and
MetaMask actions.

- Screenshot: `card-production-2049971b-ynx-launcher-fallback.png`
- SHA-256: `7db4de8fee5beb82e1845ed26932c83880c5aacc44ec4e0c4c1f87db17589eb5`

## Truth gates and rollback

- `installedWalletApproveReject=false`
- `realWalletAccount=false`
- `realSignature=false`
- `realYNXTTransfer=false`
- `cardApiAcceptedSpendableBalance=false`
- `realCard=false`
- `PANOrCVV=false`
- `fiat=false`
- `realMerchantPayment=false`
- `migrated-v2=false`

Rollback uses the preceding Ready production deployment
`dpl_CiW69BfcRsNurrv1cXxd267xi2NX` in the same Vercel project (or the older
approved rollback `dpl_8NxK9gwDyirv7hQQwJkRZ68p7r5k`). Promote/redeploy it and
read back the canonical alias and HTTP evidence. This record does not perform a
rollback.
