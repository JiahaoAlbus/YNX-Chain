# YNX DEX central integration handoff

The recovered DEX candidate is integrated locally on `codex/integrate-finance-suite`. The accepted Wallet tuple is `ynx-dex-web-v1` / `com.ynxweb4.dex.web` / `https://dex.ynxweb4.com/wallet-auth/callback`. The earlier disabled placeholder tuple is not retained as a compatibility identity.

Public pool, token, transaction and quote surfaces remain usable without login. Account positions require a fresh P-256 Product Session proof bound to `POST /v1/wallet/sessions/introspect` and the two read scopes. The DEX API forwards that one-time proof to the canonical Gateway and uses only the account returned by the Gateway. It no longer trusts browser-supplied account or session strings.

The web Wallet button creates a product-device key in IndexedDB, opens the canonical `ynxwallet://authorize` request, verifies the exact callback, completes the Gateway challenge, restores only an unexpired same-device session, and links to the official Wallet installation surface when Wallet is absent. Transaction review remains fail-closed until verified Testnet contracts and public Gateway deployment exist.

Contract compilation is isolated under `tmp/dex-hardhat/`; DEX builds no longer replace the repository-wide `artifacts/` directory or delete Finance evidence.

Local evidence passes DEX Go tests, race tests, contract integration, Web/Vitest, TypeScript/Vite build, SDK tests, Wallet registry/host/action tests, manifest checks and deterministic artifact verification. This is not public deployment, hosted download, production signing, mainnet, audited liquidity, or a claim of successful swaps.
