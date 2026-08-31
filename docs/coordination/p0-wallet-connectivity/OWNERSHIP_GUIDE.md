# P0 Ownership Guide

`wallet-protocol` owns EIP-1193, EIP-6963, WalletConnect, SIWE, Product Session,
Device Proof, product registry, callbacks, Gateway completion/introspection/
revoke, errors, and shared vectors. It does not own Wallet UI or product apps.

`wallet-platform` owns all Wallet clients, extension, DApp browser, faucet,
permissions, deep links, and Wallet artwork. It does not own Gateway schema.

`developer-sdk` owns consumer SDKs, adapters, compatibility lab, migration tools,
artwork validation, and Developer artwork. It does not own Wallet keys or UI.

`financial-apps` owns Finance, Exchange, DEX, Pay, and Quant client migration
and artwork. It consumes the shared SDK and must not fork it.

`data-fabric` owns asynchronous connection events and diagnostics only; it is
never in the synchronous connection critical path.

`explorer-monitor` owns public probes, source identity, connectivity status,
error aggregation, and its artwork. `integration` owns acceptance, manifests,
website/download truth, Shop Android retirement, public deployment, end-to-end
verification, and unassigned product migration after locks are acquired.
