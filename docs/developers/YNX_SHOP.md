# YNX Shop developer guide

## Components

- `internal/commerce`: persistence, inventory reservations, orders, Pay/Trust/AI adapters, roles, audit, and HTTP server.
- `apps/shop`: buyer Web/PWA and Android/iOS source.
- `apps/seller-console`: separate seller Web console.
- `internal/commerce/integration`: exact central Wallet registry v2 patches.

Run locally:

```sh
export YNX_SHOP_STATE_HMAC_KEY="$(openssl rand -hex 32)"
go run ./internal/commerce/cmd/shopd -http 127.0.0.1:8095
```

The buyer is served at `/shop/`, Seller Console at `/seller/`, health at `/health`, version at `/version`, and APIs at `/api`. The staging path adapters use `/shop-staging/`, `/seller-staging/`, and `/shop-api-staging/` without changing the production API contract.

## Security invariants

- Browser bearers live in module memory only. Native sessions use Android Keystore-encrypted preferences or iOS Keychain.
- Every bearer is introspected through the central product-session boundary; missing Gateway config, revocation, expiry, bundle/client/scope/account mismatch, or malformed responses fail closed.
- Shop and Seller have distinct client IDs, bundle IDs, callbacks, and least-privilege scopes. Registry payloads are in `internal/commerce/integration`.
- State uses an authenticated HMAC-SHA256 envelope when `YNX_SHOP_STATE_HMAC_KEY` is set. Tamper/wrong-key startup fails; writes are atomic and maintain a verified `.bak` recovery snapshot.
- Pay is the only authority for paid/refunded. Trust receives a bounded digest/summary and cannot decide settlement. AI allowed actions are draft-only.

## Verification

```sh
go test -race ./internal/commerce/... -count=1
go test ./...
npm --prefix apps/shop test
npm --prefix apps/shop run build
npm --prefix apps/shop run native:verify
npm --prefix apps/seller-console test
npm --prefix apps/seller-console run build
make no-placeholder-check
make secret-scan
make env-check
git diff --check
```

Android requires JDK 17 and Android SDK 36:

```sh
cd apps/shop/native/android
./gradlew --no-daemon testDebugUnitTest assembleDebug assembleRelease
```

Full Xcode is not installed on the local build host. `.github/workflows/shop-native.yml` is the runnable `macos-15` iOS simulator build/install/launch/deep-link gate.

## Dependency evidence

The Web applications have zero npm runtime dependencies; Android release uses platform APIs only. `go mod verify` passes. The linked production binary's 32 Go libraries and their detected SPDX licenses are recorded with the application surfaces in `docs/handoffs/shop-sbom.cdx.json`; the inventory contains MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, and ISC only, with no `NOASSERTION` entries.
