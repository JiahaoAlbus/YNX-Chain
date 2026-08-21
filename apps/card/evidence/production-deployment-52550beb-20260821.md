# YNX Card Testnet production deployment - 2026-08-21

## Scope and source

- Owner scope: `apps/card/**` only.
- Deployed source: `52550bebf202062b7bd6fc4dc7f5e7659f00a352`
  (`fix(card): default guest language to English`). The change makes `en` the
  first-run guest language; only an explicit saved preference may override it.
- Deployment input: mode `0700` clean checkout at
  `/private/tmp/ynx-card-release-52550beb-v2/repo`, detached at the exact
  source commit above.
- Vercel project: `jiahaoalbus-projects/ynx-card-testnet-simulation`.
  The unrelated `jiahaoalbus-projects/card` project was not used.

## Clean verification

Executed in the clean deployment input:

```text
npm ci
npm test            # 28 passed, 0 failed
npm run typecheck   # passed
npm run build:web   # passed
```

The Web build contains the bundled official MetaMask fox asset:
`assets/metamask-fox.024a98855742a7b85946088532e2d4c1.png`.

## Production deployment and readback

- Deployment ID: `dpl_AuX6P3YTkfKjFR5jCaSW3K6e6y7c`
- Deployment URL:
  `https://ynx-card-testnet-simulation-83cwhiq0p-jiahaoalbus-projects.vercel.app`
- Canonical URL: `https://card.ynxweb4.com/`
- Vercel readback: `Ready`, target `production`.
- Readback aliases: `https://card.ynxweb4.com`,
  `https://ynx-card-testnet-simulation.vercel.app`, and
  `https://ynx-card-testnet-simulation-jiahaoalbus-projects.vercel.app`.
- Canonical HTTP evidence: `200`, `1505` bytes,
  SHA-256 `8eb75115cf4a1aac5fda0a2e72690ecab2631fca809e53fd2e100f72337be348`.
- Direct deployment HTTPS readback was attempted three times with a five-second
  connection bound each time and timed out. It is therefore not claimed to have
  an independently byte-identical response; Vercel's production/alias readback
  is the deployment binding evidence.

## Browser evidence

- `card-production-52550beb-mobile-390.png` - 390 px guest layout.
  SHA-256: `0137ef082e024664625dcc9166bcf1964b4ced2da97c49f6b1891c2165a1dd7d`.
- `card-production-52550beb-desktop.png` - desktop guest layout.
  SHA-256: `0777a5395d396a817d33e0138db62ef20eb34e2575e488418ec89396e18b2b85`.
- `card-production-fa3ca9e1-mobile-390-cached-zh.png` - retained prior cached
  locale observation, not an English-default claim.
  SHA-256: `17af5aad70cc1f961496ce081e5e53dcb4a70ee3e426dc13c28bf6dccf079136`.
- Browser-visible guest page includes Overview, Virtual Card, Top up with YNXT,
  Activity, Spending Controls, Security & Help, a Testnet/Sandbox boundary,
  Download YNX Wallet, and the official MetaMask fox.
- The explicit MetaMask button was clicked. The browser has no MetaMask provider,
  so it showed the safe `MetaMask is not installed or could not be uniquely
  identified` error and did not fabricate a connection.
- Connect YNX Wallet was clicked. The page showed its complete-authorization
  request notice. The Card source policy test passed and blocks direct bare
  `ynxwallet://authorize` launches. This browser did not expose the external
  scheme target URL after the launch, so this deployment has no new browser URL
  capture of the nonempty `request` payload.
- The browser renderer continued to present Chinese-translated text even after
  the source locale state was fixed to first-run `en`, and it did not expose
  origin storage APIs for a clean-profile reset. The source default is covered
  by the committed implementation, but an independent fresh-browser English
  screenshot remains required before claiming visible English-default evidence.

## Truth gates

- `realWalletConnection=false`
- `walletApproveRejectColdStartEvidence=false`
- `realYNXTTopup=false`
- `cardApiAcceptedSpendableBalance=false`
- `realCard=false`
- `PANOrCVV=false`
- `fiat=false`
- `cardNetworkOrRealMerchantPayment=false`
- `ComputerControl=false`
- `migrated-v2=false`

The public site remains a Testnet simulation. Guest demos are local simulations
only; no balance, transaction hash, real payment, or Card session was created.

## Rollback

If a rollback is required, use the same Vercel project and promote/redeploy the
previous Ready deployment `dpl_8NxK9gwDyirv7hQQwJkRZ68p7r5k`, then read back the
`https://card.ynxweb4.com` alias and canonical HTTP evidence. This record does
not perform that rollback.
