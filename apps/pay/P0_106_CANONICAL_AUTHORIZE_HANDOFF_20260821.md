# P0-106 Pay canonical Wallet authorization handoff

Classification: `SOURCE_BUILD_CHECKPOINT_DEVICE_EVIDENCE_PENDING`.

This Pay-only checkpoint consumes `canonicalWalletAuthorize@1.0.0-p0.0` and the subsequently accepted `safeWalletAuthorizeLauncher@1.0.0-p0.0`. The vendored Wallet/Auth package is built from source `4679de8e8d0675e2013254c92ff1935191f87c21` / tree `dd6df66c3a7c8c4b53fbdbdb18b52a3284b7a690`, with tarball SHA-256 `dd80cf3d8fda3b35b89ddae6f3848dc420358b9c10d1879ed33a33f567585acb`.

## Authorization behavior

- Pay builds and validates a v2 canonical request bound to its product/client, bundle, origin, native callback, YNX Testnet chain, exact five reviewed scopes, P-256 device public key, purpose and a maximum five-minute lifetime.
- The exact canonical JSON is persisted in protected storage before `launchNativeAuthorization` resolves the complete request-bearing URI. Only a positive resolver result reaches `Linking.openURL`; a resolver result proves handler availability only, never approval, callback, session, account access or payment.
- Approval and rejection callbacks are parsed with `parseAuthorizationCallbackURL` against the stored request. The app restores a valid pending request on cold start; invalid, expired or mismatched state fails closed and is removed.
- Unsupported native launch leaves Pay in place and exposes the launcher-supplied official YNX Wallet download and independent MetaMask options. The native Pay surface has no Web/Extension authorization entrypoint, therefore Web launcher behavior is not applicable and is not claimed.
- MetaMask remains EIP-6963/EIP-1193-only. Standard Wallet connectivity remains independent from the authorization and any private-service degradation. This work neither opens nor asserts a Product Session, payment approval, signature, broadcast or settlement.

## Verification

- Typecheck: pass.
- Unit tests: pass, 15/15; includes complete launch payload, naked-route rejection, resolver fallback and callback approve/reject/mismatch binding.
- Scanner: pass, 9 non-test Pay source files, no naked or manually composed Wallet authorization launcher.
- Expo export: pass for Android, iOS and Web.
- Playwright: pass, 2/2 for the existing Pay Web/PWA UI.
- Android Debug assembly: pass. The local-only Debug APK is SHA-256 `2ff0c924bf9beb09f042005bb09c815de653613164d70e51a653d1f3233d317e`, 181,632,151 bytes. It is not production signed, hosted, installed or submitted to a store.

## Truth gates and rollback

All device installation, Wallet approve/reject/callback, cold-start, browser-visible, ComputerControl, Product Session, payment execution, public deployment, hosted download, production signing and store publication gates remain `false` for this checkpoint. `adb` reported no connected device.

Rollback is a normal revert of this Pay checkpoint after Integration confirmation. Do not restore bare deep links, direct Product Session/Gateway calls, product-composed authorization routes, or any fabricated payment status.
