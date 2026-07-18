# YNX Shop evidence index

Source commit: `38e2f68deb91d5f26e5aeec2318e260cd0742115`

## Product and integration truth

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

## Automated verification

- Commerce race suite: `go test -race ./internal/commerce/... -count=1`
- Repository Go suite: `go test ./...`
- Buyer Web: `npm --prefix apps/shop test && npm --prefix apps/shop run build`
- Native contracts/locales/privacy: `npm --prefix apps/shop run native:verify`
- Seller Web: `npm --prefix apps/seller-console test && npm --prefix apps/seller-console run build`
- Android: `./gradlew --no-daemon testDebugUnitTest assembleDebug assembleRelease`
- Integrity/dependency gates: `go mod verify`, `make no-placeholder-check`, `make secret-scan`, `make env-check`, `git diff --check`
- Runnable iOS CI: `.github/workflows/shop-native.yml`
- Repository preflight: attempted twice; both runs reached the independent faucet fixture and stopped because `127.0.0.1:6428` did not become healthy. Existing user-owned local-chain state was left untouched.

## Staging runtime evidence

- `/health` and `/version` return commit `38e2f68deb91d5f26e5aeec2318e260cd0742115`, version `0.2.0-testnet-preview`, and `integrityProtected:true`.
- Buyer and Seller paths return HTTP/2 200 through the existing Web4 TLS host.
- The API was remotely verified both through Caddy and directly on loopback.
- A service restart preserved the authenticated state file hash `bd086057018908cf96cfb9f876043bebcff7d8c13ab07273d8f879dc297116d1` and returned healthy afterward.
- Staging capabilities currently report Trust available and Wallet/Pay/AI unavailable. This is the intended fail-closed truth state until central registration and merchant inputs exist.
