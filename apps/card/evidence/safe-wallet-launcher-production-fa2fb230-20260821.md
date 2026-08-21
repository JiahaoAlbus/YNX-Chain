# Card Web safe launcher production evidence

- Source branch: 
- Source commit: 
- Deployment: 
- Deployment URL: 
- Canonical URL: 
- Deployment input: mode-0700 clean clone checked out at the source commit above.

## Launcher contract

Web Card now attempts only an explicit YNX EIP-6963/EIP-1193 provider. If none is discovered, it keeps the Card page visible and presents Retry YNX Wallet, Download YNX Wallet, and the separate standard MetaMask path. No Web custom-scheme, iframe, top-level navigation, or private Product Session launch is performed. The direct Product Session runtime fails closed until a verified Universal Link or WalletConnect route is available.

The requested accepted successor  source  was not reachable from the configured origin in this clean owner checkout, so it is not claimed as consumed. This deployment intentionally uses no substitute launcher and keeps that consumption gate false.

## Gates

- : 35/35 passed.
- : passed.
- : passed; clean build asset: .
- Source release scan for custom-scheme Web launch in , , and : passed.
- Chrome production regression: actual Chrome  baseline was 24; after clicking **Connect YNX Wallet**, it was 24. ; Card URL remained ; original-page fallback was visible; stale submitted-authorization claim was absent. Pre-existing user tabs were not changed and their identifiers are intentionally omitted.
- Screenshot: , 121948 bytes, SHA-256 .

## Canonical HTTP and asset readback

- Canonical HTML: HTTP 200, 1505 bytes, SHA-256 .
- JavaScript asset: HTTP 200, , 2884541 bytes, SHA-256 .

## Truth boundaries and rollback

- Standard Wallet remains independent from optional Product Session.
- Real wallet approval/signature, real YNXT top-up, Card API acceptance, real card/PAN/CVV, fiat, card-network clearing, real merchant payment, and ComputerControl are all false.
- Previous deployment  is retained as an operational Vercel rollback target, but it is known to contain the blank-tab launcher defect and is not a recommended product rollback.
