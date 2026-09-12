# Finance Standard Wallet SDK checkpoint — 2026-09-12

Scope: source and local tests only; no SSH, deployment, real account request, signature or transaction.

Inherited Finance business source: `6a9bb6c1ad316af0f62a791dc9fce25e05d36b96`, tree `621f0bf29283d32bfb5121f7e451d19d37bb7cdd`.
Branch: `codex/finance-wallet-flow-20260912`.

## Dependency and build

The exact standalone Standard Wallet ESM is consumed without rewriting its provider discovery, session lifecycle or permission-revocation implementation.

- Wallet source: `c97f85e9ae4d4580b99860c51738e6040ca9ca18`, tree `28a660bbe1451f0d5e20d6eb08da17eef0970d77`.
- Vendored artifact: `apps/finance/web/vendor/standard-wallet-browser-c97f85e9.mjs`, 22417 bytes, SHA256 `b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43`.
- Built `apps/finance/web/wallet-auth.js`: 16961 bytes, SHA256 `7a686fa60c9a5df0d24e72660bf590e9e295007eae88993cce00fac956c2cab7`.
- Build: `npm ci --ignore-scripts --no-audit --no-fund && npm run build:wallet` in `apps/finance/web`.

## Product behavior

YNX Wallet and MetaMask use distinct SDK-discovered providers. No selected provider means an in-place official download/install fallback, not a different provider or custom-scheme navigation. A missing chain follows switch → 4902 add → re-switch → chain readback before SDK connect. Refresh calls SDK restore silently. SDK events update accounts/chains or invalidate the connection. Local disconnect is explicitly distinct from permission revocation. Unsupported/rejected/nonempty revocation cannot claim success; an older revoke result cannot clear a newer connection. Success closes the chooser and exposes details, disconnect, switch and revoke.

Standard connection and private Finance authorization are separate. Private API replies carry account-context/revision fences. Legacy browser Product Session v1 device records are neither read, migrated, logged nor deleted. The legacy Web deep-link and raw-device-secret code is no longer built into the candidate. Private access is temporarily fail-closed pending the separate official browser v2 SDK and shared Go verifier integration; this is not a replacement authorization protocol.

## Local evidence

- `npm test`: 27/27, including exact built bundle in real local headless Chrome with explicitly injected providers. This is not installed/provider approval evidence.
- `npm run security`: PASS (320 text files).
- `go test -race ./internal/finance ./apps/finance/cmd/...`: PASS.
- Node syntax and `git diff --check`: PASS.
- Browser regression covers guest/no-provider/no blank tab, distinct discovery, chain addition, selected account restoration, revocation outcomes, cancellation, account/chain/disconnect events, newer-connection fence and late Finance HTTP response rejection.

## Remaining gates and rollback

Private v2 approval/callback/introspection/revoke integration is next, using the official SDK and exact shared Go dependency only. Web business copy remains the inherited English interface; full Web localization is not claimed. Existing mobile 12-language files are untouched. Public source binding, installed builds, real approval/rejection/signatures/transactions, WalletConnect and production deployment are all false. Do not use an old lease. Source rollback is a normal reviewed revert of this branch checkpoint; no runtime was changed.
