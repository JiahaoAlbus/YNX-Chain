# YNX DEX central integration handoff

The chain-native DEX release is integrated and public on YNX Testnet from `codex/integrate-finance-suite`. The accepted Wallet tuple is `ynx-dex-web-v1` / `com.ynxweb4.dex.web` / `https://dex.ynxweb4.com/wallet-auth/callback`. The earlier disabled placeholder tuple is not retained as a compatibility identity.

Public pool, token, transaction and quote surfaces remain usable without login. Account positions require a fresh P-256 Product Session proof bound to `POST /v1/wallet/sessions/introspect` and the two read scopes. The DEX API forwards that one-time proof to the canonical Gateway and uses only the account returned by the Gateway. It no longer trusts browser-supplied account or session strings.

The web Wallet button creates a product-device key in IndexedDB, opens the canonical `ynxwallet://authorize` request, verifies the exact callback, completes the Gateway challenge, restores only an unexpired same-device session, and links to the official Wallet installation surface when Wallet is absent. Public guest market discovery works without login. Transaction review remains fail-closed unless a valid Wallet product session and the exact chain-native action approval are available; the server does not accept a browser-supplied account as authority.

Contract compilation is isolated under `tmp/dex-hardhat/`; DEX builds no longer replace the repository-wide `artifacts/` directory or delete Finance evidence.

The public Testnet evidence records seven committed chain-native actions: asset creation/transfer, pool creation, add/remove liquidity, exact-input swap and exact-output swap. The active Indexer reports one pool, two swaps and two candle buckets, and bounded 1,000-request/64-concurrency probes pass at loopback and from independent public-TLS vantage points. Local regression evidence additionally passes DEX Go/race tests, contract integration, Web/Vitest, TypeScript/Vite build, SDK tests, Wallet registry/host/action tests, manifest checks and artifact verification. This is still not mainnet, production liquidity, production signing, store acceptance or an independent audit claim.
