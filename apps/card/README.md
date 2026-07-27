# YNX Card mobile App

Independent native Testnet Preview for `com.ynxweb4.card` with Wallet client
`ynx-card-v1` and callback `ynxcard://wallet-auth/callback`. It is not a Pay tab.

The app consumes the immutable vendored `@ynx-chain/wallet-auth` 1.0.0 tarball
from the Wallet branch at commit `efe827f467107e23482289a5b1f69ac9ff83e694`.
Tarball SHA-256:
`3feb86824135d5143e4e72e506d4efef9f530d3d931081c15500f16b1347bf2f`.
The package is not forked or edited in this product.

Set `EXPO_PUBLIC_YNX_CARD_GATEWAY_URL` to a central App Gateway containing the
registry and routes described in `docs/integration/pay-card-wallet-registry.json`.
Without that integration the App fails closed and reports Gateway unavailable.
It never calls the Card product service directly or carries a Gateway/provider
secret.

Sandbox cards are marked `TESTNET / SANDBOX` and display only provider name,
network, last four, expiry and status after local biometric/device-owner
authentication. There is no PAN, CVV, PIN, fiat balance, BIN, card-network,
Apple Pay or Google Pay claim.
