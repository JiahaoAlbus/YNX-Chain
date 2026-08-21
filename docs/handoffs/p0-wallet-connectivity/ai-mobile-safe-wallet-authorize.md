# AI Mobile safe Wallet authorization handoff

Campaign: `P0-WALLET-CONNECTIVITY-2026-08`

Task: `P0-115`

Owner: `integration`

AI Mobile no longer calls `Linking.openURL` unconditionally for a Wallet custom scheme. It verifies that the server's Wallet URL is the exact canonical URL for the returned authorization request, asks Android/iOS whether a handler exists, and opens only after a positive resolver result. If no handler is installed, the sign-in screen remains available, no local session is fabricated, and the user receives direct YNX Wallet download and MetaMask recovery actions.

Verification:

- TypeScript: passed.
- Source tests: 10/10 passed, including exact open-once, missing-handler recovery, and URL-substitution rejection.
- Product and 12-locale layout checks: passed.
- Android and iOS Expo bundle export: passed.
- Android bundle SHA-256: `4e09ef29703dd5e2ce7edc2a1304e040af1c6c5bd3906f771ac3b42b003abb74`.
- iOS bundle SHA-256: `59190e24e37f33d68281c3c444154ee444b6c08cdd74ef011bc23fdc7377831b`.

The existing repository release gate remains blocked because `release/integration/ynx-ai-contract.json` is absent. Installed-device handling, Wallet approval/rejection, callback, Product Session v2, provider-backed generation, public deployment and Computer Control remain false.
