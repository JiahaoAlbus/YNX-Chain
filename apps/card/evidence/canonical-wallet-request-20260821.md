# Canonical Wallet request follow-up - 2026-08-21

Source checkpoint: `eaa466f257bcba94fc25f33e6400a8ef7eb957b1`
Branch: `codex/p0-card-evm-ynxt-topup-20260821`

## Delivered source controls

- `Connect YNX Wallet` delegates to the accepted `createProductWalletConnection(...).beginYNX()` root factory.
- The factory test captures the route and requires a single nonempty `request` query parameter. Its decoded Product Session v2 request binds protocol version, YNX Testnet chain, Card product/client, platform identifiers, canonical origin and callback, P-256 device key, nonce/state, scopes, purpose and expiry.
- Browser Product Session callbacks accept only the registry-bound `https://card.ynxweb4.com/wallet-auth/callback`; legacy `ynxcard://wallet-auth/callback` remains recognized for native compatibility.
- `ynxWalletDeepLinkPolicy.test.ts` fails if Card release source directly opens bare `ynxwallet://authorize`.
- The guest Wallet choices retain a YNX Wallet download link and independent MetaMask/EIP-1193 connection. The bundled MetaMask fox asset is from the official MetaMask extension repository.

## Validation

- Clean `npm ci`: passed.
- `npm test`: 26/26 passed, including canonical payload and bare-route policy gates.
- `npm run typecheck`: passed.
- `npm run build:web`: passed; output includes `assets/metamask-fox.024a98855742a7b85946088532e2d4c1.png`.

## Browser and deployment truth

A preview deployment was created from the clean source worktree:

- Deployment: `dpl_4mBiEHL4GEGT7JYNyb7Couga4YtN`
- URL: `https://ynx-card-testnet-simulation-b4bzsfifm-jiahaoalbus-projects.vercel.app`
- Vercel state: `Ready`
- Target: preview only; no production alias was changed.

The live canonical page was independently observed as the old UI (including the placeholder MetaMask `M`), so it is not evidence for this source checkpoint. Its HTTP probe returned `200`, `1505` bytes, SHA-256 `9bd753b561be9e43b4b21bed079029581251018bc57b2bdceb2d3b82b7ffc10b`.

The browser and local HTTPS environment could not reach the newly created preview after Vercel reported it Ready. No real YNX Wallet is installed in the available browser environment. Therefore there is **no** valid evidence of a Wallet approval page, approve/reject callback, or cold-start restoration, and the canonical `https://card.ynxweb4.com/` alias was deliberately not promoted.

## Remaining release blocker

Use a real Wallet-enabled device or browser to capture the complete request page and prove approve/reject return plus cold-start pending recovery. Until then: `walletApprovalVisible=false`, `walletApproveReturn=false`, `walletRejectReturn=false`, `walletColdStartRecovery=false`, `migrated-v2=false`, `realYnxtTopup=false`, `realCard=false`, `fiat=false`, `PAN=false`, `CVV=false`, `realMerchantPayment=false`.
