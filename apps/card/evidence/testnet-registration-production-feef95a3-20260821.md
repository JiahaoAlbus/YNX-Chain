# Card Testnet registration production evidence

Source branch: codex/card-registration-testnet-20260821
Source commit: feef95a37cec8acf75f5855118e1fc79170721fd
Production deployment: dpl_DdMDsSbeAB7xV1npEWc6h2q2sUX2
Deployment URL: https://ynx-card-testnet-simulation-mickj2jd2-jiahaoalbus-projects.vercel.app
Canonical apex: https://card.ynxweb4.com/

## Registration contract

The Card-owned registration state machine persists and restores DRAFT, APPROVAL_REQUIRED, SUBMITTED, ACTIVE, REJECTED, CANCELLED, and DEGRADED. It is wallet-address bound, has transition idempotency, keeps an audit trail, and only permits ACTIVE from a verified sandbox receipt. The public Guest experience remains visible before a wallet connection and never creates an application automatically.

A missing accepted Card backend receipt causes DEGRADED. It does not create a wallet signature, backend account, ACTIVE card, balance, top-up intent, PAN, CVV, fiat path, card-network settlement, or real merchant payment.

## Gates and public observation

- Clean dependency install completed.
- npm test: 37/37 passed.
- npm run typecheck: passed.
- npm run build:web: passed.
- Root independent real-Chrome observation on the canonical public page: Create a Testnet Card application was visible; Guest browsing remained available; selecting Start application without a Standard Wallet showed the connection requirement and did not create a card, balance, or top-up; YNX Wallet and MetaMask remained separate entry points; no automatic application was created.
- This Root observation is public browser evidence only. It is not evidence of wallet signature, backend acceptance, ACTIVE, funding, or ComputerControl.

## Canonical HTTP and immutable asset readback

- HTML: HTTP 200, 1505 bytes, SHA-256 e6f3ffbb1dbd161f9352630db4a73c9472d94090cda63bc9ab3ec0065c2f6003.
- JavaScript asset: HTTP 200, /_expo/static/js/web/index-be13f79710f6766e6e588dc6defe5518.js, 2893420 bytes, SHA-256 4488e36a198e64b12e2e4d675a907248db5f8cae8d4c8470131fdab3146307cd.

## Explicit false gates

- Wallet signature: false.
- Sandbox backend receipt and account acceptance: false.
- ACTIVE virtual card: false.
- Real YNXT top-up and Card API acceptance: false.
- Real PAN, CVV, balance, fiat, card-network clearing, and merchant payment: false.
- ComputerControl: false.
