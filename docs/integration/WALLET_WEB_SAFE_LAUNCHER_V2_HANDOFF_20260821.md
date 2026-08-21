# Wallet Web / Extension safe launcher v2 handoff

Owner branch: `codex/wallet-web-provider-v2-20260821`.

The Web/PWA/extension surface consumes Central's accepted
`safeWalletAuthorizeLauncher@2.0.0-p0.0` source `f1ba5013` (contract digest
prefix `defd0db6`). It does not add a second authorization protocol and does
not modify Wallet Protocol, Gateway, registry, or Integration.

## Source checkpoints

- `a28c40798fb9509589326b36894e760c9cb18d0e`: Web and extension contexts
  validate canonical routes but never navigate `ynxwallet:`; absent injected
  providers use the official YNX download and standard MetaMask fallback, with
  no pending Product Session.
- `5b4ab248f4768fec586e7aa5c9fc1db2281af569`: the explicit safe-launcher
  result takes precedence over private Gateway readiness, so the UI explains
  that navigation is prohibited instead of reporting an unrelated auth outage.

## Local browser regression evidence

`apps/wallet-web/evidence/browser/wallet-web-safe-launcher-v2-browser-20260821.json`
and its PNG record a local, headless Playwright Chromium run at 390 x 844:

- `npm test`: 91/91 pass; `npm run build`: pass.
- Clicking the YNX route leaves the only top-level page at its original URL.
- No `about:blank` page and no `ynxwallet:` navigation are observed.
- The page shows `WEB_CUSTOM_SCHEME_NAVIGATION_PROHIBITED`, YNX download, and
  MetaMask fallback. Add/switch/sign/send stay disabled.

This is a local browser regression only. It is not a physical device,
installed extension, provider discovery, account, approval/reject/callback,
Testnet, public deployment, signing, or store-release proof. All of those
remain false.
