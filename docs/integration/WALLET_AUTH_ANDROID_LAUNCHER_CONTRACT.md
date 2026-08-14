# Shared Android Wallet Launcher Contract

The machine-readable authority is `release/integration/wallet-auth-android-launcher-contract.json`.

All Android ecosystem callers must build the canonical request through `@ynx-chain/wallet-auth` and launch exactly `ynxwallet://authorize?request=<base64url-canonical-authorization-request>` for package `com.ynxweb4.wallet`. The route has scheme `ynxwallet`, host `authorize`, an empty path and one `request` query field. Callers may not hand-concatenate variants.

Before launch, the shared launcher must call `resolveActivity`/`queryIntentActivities`, validate the exact Wallet package, and then launch safely. No handler must produce a bounded `WALLET_APP_UNAVAILABLE` UI with YNX Wallet download and MetaMask mobile options; raw `ActivityNotFoundException` text must not escape. Opening Wallet is not authorization success.

Wallet must export an exact VIEW/DEFAULT/BROWSABLE filter for that route and pass the URI to the existing strict parser. Wrong product, bundle, device and widened scope remain fail-closed. Callback completion requires the exact enabled Product registry callback with one `response` field and a valid Product Session.

Acceptance requires direct, secret-free Pixel 9/API 36 evidence with Wallet, Social and at least one other ecosystem app installed: resolver enumeration, approve, reject, callback, Product Session and second launch. The current direct observation is negative (`No Activity found to handle Intent` after a visible security-check failure), so every acceptance and release boolean remains false.

`scripts/verify/wallet-auth-android-launcher-callers-check.mjs` scans release app sources and bundles. Normal mode is the promotion gate and must reach zero legacy schemes/routes and zero caller-side canonical URI construction. `--expect-blocked` is only the current freeze check: it proves the known legacy callers remain visible and prevents documentation from hiding them. Monitor still uses `ynx-wallet://authorize?challenge=`, Trust Center uses `ynxwallet://sign-app-session`, and the shared mobile session binding contains `ynx-wallet://com.ynxweb4.wallet`; the scanner may expose additional callers. Product callbacks stay registry-bound and must not be silently rewritten during migration.
