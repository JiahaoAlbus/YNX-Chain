# YNX Music central integration patch

Status: `implemented-local`; `integrated-central: false`.

The committed Wallet Auth v2 registry entry is [`wallet-registry-v2.json`](wallet-registry-v2.json). The central owner must merge this exact object into the canonical registry and expose the three server-to-server operations below. Music does not embed a verifier, mint its own session, or fall back to legacy bearer credentials.

## Exact operations

All calls are `POST` JSON, authenticated by the operator-provisioned server credential, and carry `X-YNX-Product-Client: ynx-music-v1`. Unknown fields and non-2xx responses are rejected.

1. Challenge endpoint (`YNX_MUSIC_WALLET_CHALLENGE_URL`)

   Request: `{ "authorizationRequest": <13-field Wallet request>, "walletApproval": <exact Wallet approval> }`.

   Response: `{ "challenge": <exact 11-field Gateway challenge> }`.

2. Session endpoint (`YNX_MUSIC_WALLET_SESSION_URL`)

   Request: `{ "authorizationRequest": <request>, "walletApproval": <approval>, "gatewayCompletion": { "challenge": <challenge>, "deviceSignature": <base64url P-256 DER signature> } }`.

   Response is the exact committed Wallet Auth `wallet-auth-v1` session: `verifierVersion`, `sessionBinding`, `productClientId`, `bundleId`, `productDeviceAlgorithm`, `requestDigest`, `account`, `scopes`, `issuedAt`, `expiresAt`.

3. Introspection endpoint (`YNX_MUSIC_WALLET_VERIFY_URL`)

   Request: `{ "sessionBinding", "productClientId", "bundleId", "productDeviceKey", "requiredScopes": [<one scope>] }`.

   Response: `{ "active": true|false, "session": <exact wallet-auth-v1 session> }`. The central implementation must recover the original completion, assert non-revocation and expiry, and bind the supplied compressed P-256 key to that completion before returning `active: true`.

The product signs `"YNX_PRODUCT_SESSION_CHALLENGE_V1\n" + canonicalJSON(challenge)` using the device-bound P-256 key. Android stores the key in Android Keystore; iOS stores it in Keychain. The callback accepts exactly one query item named `response`. Exact completion replay is rejected by Music as a second line of defense.

## Merge verification

- Parse the registry entry with committed `parseCentralRegistryEntry`.
- Run the canonical Wallet Auth vectors for wrong product, callback, device key, scope, expiry, revocation, tampered approval, tampered challenge and replay.
- Deploy all three endpoints, inject only server-side credentials, and set `centralIntegrated` to true only after a production/staging health check proves the deployed registry and verifier version.
