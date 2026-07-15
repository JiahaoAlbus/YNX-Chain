# Next Action

Highest-priority bounded delivery (2026-07-15):

Current single action: deploy the persistent Social handle and product-scoped Gateway release, then build and install separate test-only YNX Social and YNX Wallet Android Release packages. Prove that Social uses username/QR discovery and has no Wallet/Pay/Network navigation, while Wallet has no Feed/Chat navigation.

Why this is next:

- The user rejected the mixed super-App architecture. The current integration binary is now explicitly internal-only.
- Unique Social handles, public resolution, Chat profile display, separate package identities, and Gateway route isolation are implemented and locally tested.
- Remote Square/Gateway still run release `09598d2cbcd7`, so the new Social package cannot yet complete a product-bound ownership session or resolve handles remotely.
- Installed proof is required before either standalone package can be described as usable. Production signing, stores, and complete benchmark parity remain later gates.

Files to touch:

- `internal/square`, `cmd/ynx-squared`
- `internal/appgateway`, `cmd/ynx-app-gatewayd`
- `apps/mobile`
- `scripts/package/mobile-android-release.sh`
- `scripts/verify/mobile-product-split-check.sh`
- API and acceptance documentation only after matching evidence exists

Required implementation and verification:

- Preserve existing Square state, audit integrity, profiles, notifications, posts, comments, reactions, follows, reports, and rollback evidence during scoped deployment.
- Deploy exact source-built Square and Gateway binaries with existing server-only credentials and no authoritative-chain restart.
- Verify exact remote build IDs, public handle route behavior, private-route denial, product client binding, healthy Chat/Square/Pay upstreams, and zero leaked sessions.
- Build externally test-signed Social and Wallet APK/AAB artifacts with exact provenance and no production-signing claim.
- Install both new package IDs on the connected Pixel without deleting the internal package or unrelated phone data.
- Verify Social and Wallet foreground identity, navigation separation, embedded Hermes, no fatal log, and truthful unavailable/locked states.

Validation commands:

- `go test ./...`
- `make square-api-check`
- `make app-gateway-check`
- `make app-account-ownership-check`
- `make mobile-check`
- `make mobile-product-split-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`

Completion standard:

- Remote Square/Gateway exact release and scoped backup are verified without state loss.
- Separate Social and Wallet test-only Release packages are installed and render their own product workflows on Pixel.
- Social account discovery accepts `@handle`/Social QR and never asks the user for a wallet address.
- No mainnet, production signing, store acceptance, exchange listing, stablecoin support, wallet default support, partnership, benchmark parity, or independent proof is inferred.

Explicitly not doing:

- Do not restore the mixed super-App as the consumer architecture.
- Do not create empty Exchange, Shop, AI, Monitor, Browser, Bank, desktop, groups, media, or moments screens.
- Do not expand bounded EVM/IDE except to preserve passing tests.
- Do not modify or replace the long-term goal file.
