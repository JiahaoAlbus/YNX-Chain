# Wallet / DApp connection architecture — Candidate

Layer A is a standard Wallet Connection: EIP-1193 / EIP-6963 or WalletConnect transports expose only the user-approved EVM account, chain, methods and events. It does not read the YNX registry, reach the Central Gateway, create a Product Session, upload device proof, or require a YNX callback.

Layer B is a YNX Enhanced Product Session for first-party private APIs only. It is explicitly upgraded after Layer A and binds the registered tuple, device proof, ordered scopes and Gateway lifecycle. A Layer B outage reports `DEGRADED_PRODUCT_SESSION`; it never deletes the Layer A account, signing, or transaction capability.

This is a candidate, not an accepted or activated consumer contract.
