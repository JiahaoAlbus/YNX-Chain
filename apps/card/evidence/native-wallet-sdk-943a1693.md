# Card native Wallet identity source receipt

- Card consumes `@ynx-chain/wallet-auth@1.1.0` from `vendor/ynx-chain-wallet-auth-1.1.0-943a1693.tgz`.
- Package SHA-256: `81f6dd462fc3ebd464670ec6024cfa37c16717dd1ca24f2d3c2cb7f40076cf14`.
- SDK source checkpoint: `943a16930ec99aa2b9c124812336dd12d7880320`; tree: `1351ec930bc7618585b8d66d59596a6911110fe5`.
- Card registry: `vendor/product-session-registry-943a1693.json`; SHA-256: `1dd3c6fdf8cfaab8d1ec4cf635223eac0f6da918e5973cd87217c2274bbd4847`.
- Native-only composition is `ProductSessionGatewayFetchAdapter` + `RecoverableProductSessionClient` + `WalletConnectionCoordinator` at fixed origin `https://wallet-auth.ynxweb4.com`.
- First native request is constrained to `account:read`; it cannot create a card, authorize funding, or authorize a payment.
- Web keeps the existing Standard EIP-1193 flow and never launches `ynxwallet://`.
- This is source and deterministic fixture evidence only. Installed-wallet approval/rejection/callback recovery, public deployment, Card API acceptance, card activation, YNXT funding, signing, and transactions remain false.
