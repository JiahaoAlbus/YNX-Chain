# YNX Wallet

YNX Wallet is the independent self-custody, identity, authorization, signing, device and recovery product for YNX Testnet. It is not a Social, Pay, Shop or DEX shell.

## User flows

- Create, import and recover secp256k1 accounts; the default identity shown to users is `ynx1...`.
- Keep multiple accounts, switch explicitly, lock on background and require strong system biometrics for key use.
- Read authoritative YNXT balance, nonce and activity from `https://rpc.ynxweb4.com`.
- Review, sign and broadcast a canonical native transfer only after a biometric Send Review.
- Review exact product, client, bundle, callback, device key, account, scopes, purpose and expiry before Sign in with YNX Wallet approval.
- Inspect connected apps, sessions, devices and the tamper-evident authorization audit; revoke locally and require the central Gateway to enforce synced revocation.

The recovery key restores native accounts only. Product device keys, sessions, replay records and local audit records are intentionally not restored to a replacement device.

## Development

Requirements are Node.js, npm, Java 17 and Android SDK 36. A full iOS native build additionally needs Xcode and CocoaPods.

```sh
npm ci
npm run check
cd android
ANDROID_HOME=/path/to/android/sdk ./gradlew assembleRelease
```

The release APK is test-signed for Testnet Preview. Never place production keystores, Apple signing material, account secrets or provider keys in this repository.

## Protocol

The canonical shared package is `packages/wallet-auth`. Product requests use:

```text
ynxwallet://authorize?request=<base64url(canonical JSON)>
```

Unknown fields, identity/callback/scope substitution, expiry, replay, tamper and cross-App session reuse fail closed. See `packages/wallet-auth/CENTRAL_INTEGRATION.md` and `SECURITY_BOUNDARIES.md`.
