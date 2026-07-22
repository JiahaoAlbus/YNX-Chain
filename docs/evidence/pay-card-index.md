# Pay, Merchant Console and Card evidence index

## Passing evidence

- Go: full repository tests plus Pay/Card race suites.
- Pay: six client tests, TypeScript, Android/iOS Hermes exports, Android lint
  vital/release assembly. APK SHA and size are in `apps/pay/product-release.json`.
- Merchant: seven tests, zero npm vulnerabilities and canonical-Wallet
  production bundle.
- Card: eight client tests, Android/iOS Hermes exports, Android lint vital/
  release assembly, sandbox lifecycle/provider replay/store tamper/race tests.
- Security gates: env, placeholder and secret scans and central Pay API check.
- Canonical package and controller input:
  `docs/integration/pay-card-wallet-registry.json`.

## Historical evidence only

- `internal/payproduct/proof/live-testnet-payment.json` proves an older build's
  real committed Testnet payment. It is not the fresh proof required for this
  build.
- Merchant `proof/*.png` and earlier Card runtime captures predate the current
  canonical-Wallet/UI changes.

## Failure/blocker evidence

- `apps/pay/evidence/android/anr-emulator-failure.png` records the Android
  emulator ANR observed before the emulator system died. It is not install
  success evidence.
- Public read-only health checks passed for central Pay, RPC and Faucet, but the
  product Gateway domain returned deployment-not-found.
- SSH authentication to the documented primary node was rejected for all
  available local keys. No remote mutation was performed.
