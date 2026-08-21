# Card Web safe launcher production evidence

- Source branch: `codex/p0-card-web-provider-20260821`
- Source commit: `fa2fb2308470ded24d64333b756718e7d04bfced`
- Deployment: `dpl_AFJ1hJQWWuWH7bZxjweMAGKeh18n`
- Deployment URL: `https://ynx-card-testnet-simulation-a79svjfrz-jiahaoalbus-projects.vercel.app`
- Canonical URL: `https://card.ynxweb4.com/`
- Deployment input: mode-0700 clean clone checked out at the source commit above.

## Launcher contract

Web Card now attempts only an explicit YNX EIP-6963/EIP-1193 provider. If none is discovered, it keeps the Card page visible and presents Retry YNX Wallet, Download YNX Wallet, and the separate standard MetaMask path. No Web custom-scheme, iframe, top-level navigation, or private Product Session launch is performed. The direct Product Session runtime fails closed until a verified Universal Link or WalletConnect route is available.

The requested accepted successor `safeWalletAuthorizeLauncher@2.0.0-p0.0` source `f1ba5013` was not reachable from the configured origin in this clean owner checkout, so it is not claimed as consumed. This deployment intentionally uses no substitute launcher and keeps that consumption gate false.

## Gates

- `npm test`: 35/35 passed.
- `npm run typecheck`: passed.
- `npm run build:web`: passed; clean build asset: `/_expo/static/js/web/index-4a87ea824d09562d66e977328ecf948c.js`.
- Source release scan for custom-scheme Web launch in `App.tsx`, `productWalletRuntime.ts`, and `ynxWalletLauncher.ts`: passed.
- Owner Chrome production regression: actual Chrome `openTabs` baseline was 24; after clicking **Connect YNX Wallet**, it was 24. `createdCount=0`; Card URL remained `https://card.ynxweb4.com/`; original-page fallback was visible; stale submitted-authorization claim was absent. Pre-existing user tabs were not changed and their identifiers are intentionally omitted.
- Integration independent Chrome regression: navigated to `https://card.ynxweb4.com/?verify=blanktabfix-fa2fb230`; after the exact button click and 2.5 seconds, URL was unchanged, `createdCount=0`, Download YNX Wallet and MetaMask were visible, old submitted text was absent, and the alert stated that no provider was detected and no session, approval, or transaction was created.
- Screenshot: `card-production-fa2fb230-chrome-ynx-fallback.png`, 121948 bytes, SHA-256 `2cf42ab513ab0b6bcc1044cdb185463edf43c1c1e3d70e357c741c3f6cb84275`.

## Canonical HTTP and asset readback

- Canonical HTML: HTTP 200, 1505 bytes, SHA-256 `c8627cbcf9bf12bb8ad3aab2e8dc0e8e486b093a12060fe8a7a3318621da0bd8`.
- JavaScript asset: HTTP 200, `/_expo/static/js/web/index-4a87ea824d09562d66e977328ecf948c.js`, 2884541 bytes, SHA-256 `b28f7c680e8d094839914a8446098c869776f20e5f8f66a88c9b06b0fbd0a02c`.

## Truth boundaries and rollback

- Standard Wallet remains independent from optional Product Session.
- Real wallet approval/signature, real YNXT top-up, Card API acceptance, real card/PAN/CVV, fiat, card-network clearing, real merchant payment, and ComputerControl are all false.
- Previous deployment `dpl_8LDwzRT6DdWwwjyBPXTrMmGuEAyx` is retained as an operational Vercel rollback target, but it is known to contain the blank-tab launcher defect and is not a recommended product rollback.
