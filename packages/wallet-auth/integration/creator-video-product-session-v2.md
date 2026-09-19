# Creator and Video Product Session v2 contract

This contract is based on the public Auth runtime source `6cf3ef845202bd879ed94515a71b323dd2fc9e14`, with the Creator registry base application ID corrected. It describes protocol compatibility; it does not claim a completed installed-wallet or public product flow.

| Field | Creator Studio | Video |
| --- | --- | --- |
| productId | `creator-studio` | `video` |
| clientId | `ynx-creator-studio-web-v1` | `ynx-video-mobile-v1` |
| Registry base applicationId | `com.ynxweb4.creator-studio` | `com.ynxweb4.video` |
| Web applicationId | `com.ynxweb4.creator-studio.web` | `com.ynxweb4.video.web` |
| Web origin | `https://creator.ynxweb4.com` | `https://video.ynxweb4.com` |
| Web callback | `https://creator.ynxweb4.com/wallet-auth/callback` | `https://video.ynxweb4.com/wallet-auth/callback` |
| Native callback | `ynxcreator://wallet-auth/callback` | `ynxvideo://wallet-auth/callback` |
| Registered scopes | `creator:account`, `creator:publish`, `creator:revenue` | `video:account`, `video:library`, `video:playback` |

For Web, `platform` is `web` and both `bundleId` and `packageId` are null. The `.web` suffix is added once by `productPlatformBinding`; callers must use the derived binding, not add another suffix. Each product uses its own registered origin and callback. The current registry does not register the shared `https://web4.ynxweb4.com` origin or a callback under its product subpaths.

## Login and return

Use `RecoverableProductSessionClient` with a protected P-256 device signer and storage. The product prepares and persists its pending v2 request before opening `ynxwallet://authorize?request=...`. The installed Wallet validates the exact registry binding and explicitly asks the user to approve the requested account and scopes. It signs with the YNX account key and returns using `createProductSessionReturnURL`.

An approved callback has exactly `result=approved`, `approval=<base64url canonical JSON>`, `nonce`, and `state`. A rejected callback has exactly `result=rejected`, `reason=user_rejected`, `nonce`, and `state`. `parseProductSessionReturnURL` verifies the pending request, origin, path, state, nonce, approval binding, expiry, and signature. Legacy `gateway_session`, `session`, or `response` parameters are not v2 callbacks.

After a verified approval, the product obtains a challenge from `/v2/product-sessions/challenge`, signs it with its P-256 device key, calls `/v2/product-sessions/complete`, and confirms the issued session by introspection. Preserve the pending request and callback on network failure so the SDK can retry without inventing a session. The challenge and completion calls support exact request-ID/body idempotency. An account change requires a new explicit approval; a failed or rejected return must not bind an account.

## API authorization

The product API decides the required scopes from its route. For a Creator publishing operation, use `creator:publish`. Do not trust a caller-supplied list to decide authorization.

The API forwards a fresh device proof to `https://wallet-auth.ynxweb4.com/v2/product-sessions/introspect`:

- Method: `POST`.
- `Content-Type: application/json` exactly.
- `x-request-id`: a fresh value matching `req_[A-Za-z0-9_-]{12,80}`.
- `x-ynx-product-session-proof-v2`: `encodeProductSessionGatewayProofHeaderV2(proof)`.
- Body: `canonicalJSON({ requiredScopes: [...] })`, with the route's exact sorted scopes.

Create the proof with `createProductSessionProofV2With` and the product's protected device signer. Its method is `POST`, its path is `/v2/product-sessions/introspect`, and its `bodyDigest` is `httpBodyDigest` of that exact canonical introspection body. A proof signed for `/video/api/...` cannot authorize the Auth introspection route. Keep proof lifetime within 60 seconds and within the session lifetime. Successful introspection consumes the proof once; retries require a fresh nonce and signature.

The success envelope has `schemaVersion: 2`, `ok: true`, matching `requestId`, and `result: { active: true, session }`. Verify the returned session's exact `productId`, `clientId`, `platform`, `applicationId`, `bundleId`, `packageId`, `origin`, and `callback` against the product's binding; derive the account from the verified session. v1 names such as `requestingProduct` and `productClientId` do not describe v2 sessions. The API must also enforce the incoming browser Origin against its configured product origin and the proof binding. It must return an authorization error on missing, invalid, expired, replayed, revoked, cross-product, or under-scoped proofs.

The Auth Node host accepts browser requests only when the HTTP Origin matches the signed request or proof origin. Native clients and server proxies may omit Origin; they still require the full signed protocol. CORS acceptance alone grants no session authority.

## Deployment and validation

The daemon uses the explicit `YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH` in remote deployments. Updating repository JSON alone does not update that deployed registry. Freeze and hash both the source package and deployed registry; preserve `YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH` and its existing durable state. Read back `/version`, registry hash, and the actual unit/ExecStart after deployment. Do not replace the current v2 runtime or registry with a Desktop package's old v1 material.

Local regression coverage: `test/creator-video-contract-v2.test.mjs` reproduces the old Creator `.web.web` failure, then exercises exact approved/rejected callback handling, signed challenge/completion, API introspection, wrong path/body/product/callback, scope expansion, and proof replay. `test/product-session-gateway-node-host.test.mjs` verifies real loopback HTTP, CORS plus signed Origin binding, durable restart and revocation, and zero state mutation on rejected origins. These tests use fixed public test fixtures; they are not live accounts or evidence of installed UI approval.

The remaining product acceptance is a fresh installed Wallet approval followed by the correct product return and API binding, then Creator upload, review, publish and Video guest playback through the real public services. YNX Wallet approval and MetaMask/EVM connection remain separate identities and protocols.
