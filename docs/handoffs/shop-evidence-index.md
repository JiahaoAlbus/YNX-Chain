# YNX Shop evidence index

Current source commit: `0347320463466cf9a265c7447fbced0218a32cab`

Privacy runtime commit: `4cd59fcb11e11d221defa88d20ac0d50b7663b99`

Prior Staging/artifact source: `38e2f68deb91d5f26e5aeec2318e260cd0742115`

## Current-source product and integration truth

- `.ai-bridge/full-goal-coverage.json`
- `apps/shop/product-release.json`
- `apps/shop/public-product-metadata.json`
- `release/integration/ynx-shop-contract.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- `internal/commerce/privacy_test.go`

## Preserved prior product and integration evidence

- `apps/shop/product-release.json`
- `apps/seller-console/product-release.json`
- `internal/commerce/integration/shop-registry-v2.json`
- `internal/commerce/integration/seller-registry-v2.json`
- `docs/handoffs/shop-central-integration.md`
- `docs/handoffs/shop-artifact-manifest.json`
- `docs/handoffs/shop-sbom.cdx.json`

## Visual evidence

- Shop before/after: `apps/shop/evidence/shop-before-after-desktop.jpg`
- Shop desktop light: `apps/shop/evidence/shop-desktop-light-1440x900.jpg`
- Shop desktop dark: `apps/shop/evidence/shop-desktop-dark-1440x900.jpg`
- Shop Arabic RTL mobile: `apps/shop/evidence/shop-mobile-arabic-rtl-390x844.jpg`
- Shop deployed staging: `apps/shop/evidence/shop-staging-desktop-720x450.jpg`
- Seller before/after: `apps/seller-console/evidence/seller-before-after-desktop.jpg`
- Seller desktop light: `apps/seller-console/evidence/seller-desktop-light-1440x900.jpg`
- Seller Arabic RTL mobile: `apps/seller-console/evidence/seller-mobile-arabic-rtl-390x844.jpg`
- Visual-only product fixture: `apps/shop/evidence/visual-fixture-field-kit.png`
- Fixture state: `apps/shop/evidence/visual-state.json`
- Design conclusions: `UI_DESIGN_AUDIT.md`

## Android evidence

- APK: `apps/shop/release/ynx-shop-0.2.0-testnet-preview.apk`
- Checksums: `apps/shop/release/SHA256SUMS`
- Install/cold/restart/deep-link transcript: `apps/shop/native/evidence/android-install-20260718.txt`
- Current-run deep-link rejection/simulator-host-ANR capture: `apps/shop/native/evidence/android-testnet-preview-deep-link-rejection.png`
- Earlier clean cold-launch splash reference: `apps/shop/native/evidence/android-cold-launch.png`

The current-run transcript is authoritative for install and launch. The current read-only emulator later raised a System UI ANR under host contention; the application remained visible behind the system dialog and had already completed both cold starts and deep-link delivery.

## Current-source automated verification

- Commerce race suite: `go test -race ./internal/commerce/... -count=1` — pass.
- Buyer Web: `npm --prefix apps/shop test` — pass, 5 tests including twelve-locale privacy copy.
- Buyer Web build: `npm --prefix apps/shop run build` — pass.
- Buyer Web smoke: `npm --prefix apps/shop run smoke` — `/health`, `/api/capabilities` and `/api/products` pass.
- Native contracts/locales/privacy: `npm --prefix apps/shop run native:verify` — pass.
- Native privacy copy: all twelve Android resource catalogs and all twelve iOS catalog languages include privacy controls, warnings and dynamic result states; Arabic-script and RTL wiring checks pass.
- Validation scanner unit suite: `node --test scripts/validate/scan-regex.test.mjs` — pass, 2 tests.
- Placeholder gate: `make no-placeholder-check` — pass through the Node fallback because ripgrep is absent.
- Secret gate: `make secret-scan` — pass through the Node fallback because ripgrep is absent.
- Shell syntax: `bash -n scripts/validate/no-placeholder-check.sh scripts/validate/secret-scan.sh` — pass.
- Current Android build: `./gradlew assembleDebug` — blocked because Android SDK location is not configured on this host.
- Current iOS build: `xcodebuild ... iphonesimulator ...` — blocked because the active developer directory is Command Line Tools, not full Xcode.
- Repository Go suite: `go test ./...` — not green. Three shared macOS permission assertions and two consumers of the missing generated `SampleEVMWriteCounter` artifact fail; Commerce is unaffected and passes independently.

## Preserved prior verification

- Seller Web tests/build, Android API 36 build/install and runnable iOS CI evidence below refer to source `38e2f68` unless a newer source is explicitly named.
- Repository preflight was previously attempted twice; both runs reached the independent faucet fixture and stopped because `127.0.0.1:6428` did not become healthy. Existing user-owned local-chain state was left untouched.

## Preserved prior Staging runtime evidence

This section is evidence for source `38e2f68deb91d5f26e5aeec2318e260cd0742115`, not the current `0347320` source.

- `/health` and `/version` return commit `38e2f68deb91d5f26e5aeec2318e260cd0742115`, version `0.2.0-testnet-preview`, and `integrityProtected:true`.
- Buyer and Seller paths return HTTP/2 200 through the existing Web4 TLS host.
- The API was remotely verified both through Caddy and directly on loopback.
- A service restart preserved the authenticated state file hash `bd086057018908cf96cfb9f876043bebcff7d8c13ab07273d8f879dc297116d1` and returned healthy afterward.
- Staging capabilities currently report Trust available and Wallet/Pay/AI unavailable. This is the intended fail-closed truth state until central registration and merchant inputs exist.
