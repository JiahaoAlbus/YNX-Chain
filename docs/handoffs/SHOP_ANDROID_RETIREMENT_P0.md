# Shop Android Retirement: P0

Status: `RETIREMENT_IN_PROGRESS`

The Android build/release workflow and new public APK distribution are withdrawn
under `P0-WALLET-CONNECTIVITY-2026-08`. Shop Web/PWA remains the replacement
surface at `https://shop.ynxweb4.com/shop/`. The historical debug-signed Testnet
Preview and its evidence remain in Git history; they are not an active download.

This source change cannot uninstall an APK already present on a device. The
remaining control-plane enforcement is to return `CLIENT_RETIRED` for the Android
package/callback, revoke associated sessions, approvals, and device grants, and
remove all website download routes. Those actions depend on the accepted shared
Wallet Protocol and must not be simulated locally.
