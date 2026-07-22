# Trust Center and Resource Market evidence index

## Current-run verification

- Full repository Go suite: passed with the base workspace's read-only generated-contract artifacts temporarily linked; the link was removed.
- Product race suite: `internal/productstore`, `internal/canonicalwallet`, `internal/trustproduct`, and `internal/resourceproduct` passed.
- Real HTTP smoke: `apps/trust-center/check.sh` and `apps/resource-market/check.sh` passed against fresh persisted stores.
- Browser UI: Trust 4/4 and Resource 4/4, including desktop, mobile, full core workflow, 12 locales, persistence, Arabic text direction, LTR structural shells, and honest AI failure.
- Android: both debug APKs built cleanly. Resource Market was freshly rebuilt, installed, and cold-started on Android 16; see `apps/resource-market/evidence/android-debug-install-20260722.json`. Trust Center installation remains unclaimed.
- iOS: both plists lint and Swift sources parse; full build/install is unclaimed because full Xcode and Simulator are absent. Runnable macOS CI is included.

## Visual evidence

All current screenshots are under `docs/handoffs/evidence/ui-audit-current/`. Canonical review files are:

- `trust-center-desktop.png`, `trust-center-mobile.png`
- `resource-market-desktop.png`, `resource-market-mobile.png`
- `trust-desktop-final-light.png`, `trust-desktop-final-dark.png`, `trust-mobile-390x844.jpg`
- `resource-desktop-final-light.png`, `resource-desktop-final-dark.png`, `resource-mobile-390x844.jpg`

## Protocol evidence

- `apps/*/integration/canonical-wallet-registry.json`
- `apps/*/integration/canonical-wallet-v1-test-vector.json`
- `apps/*/integration/central-integration-manifest.json`
- `docs/handoffs/integration/trust-resource-central.patch.json`
- `docs/handoffs/trust-resource-sbom.spdx.json`

These are merge inputs and fail-closed vectors, not proof of central deployment.
