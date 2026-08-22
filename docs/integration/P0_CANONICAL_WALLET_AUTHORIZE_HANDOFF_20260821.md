# P0 canonical Wallet authorization handoff

Status: source-only frozen. This handoff authorizes no product UI edit, production operation, device claim, deployment or migration promotion.

## One transport contract

The only valid native Wallet authorization transport is produced by `encodeRequestDeepLink(request)` from the package root:

```text
ynxwallet://authorize?request=<base64url(canonical-json-request)>
```

`ynxwallet://authorize`, an empty `request`, another query name, extra query state, a fragment, a substituted route, or a manually supplied callback fails closed. The exact machine-readable contract is `packages/wallet-auth/integration/canonical-wallet-authorize-v1.json`.

The request binds protocol version, nonce, native chain, product/client/native identity, P-256 device public key, exact callback, ordered scopes, purpose, issue time and expiry. `requestDigest` covers the canonical request. Wallet approval adds the selected account/public key and a secp256k1 signature; rejection grants no authority. Both decisions return only through `createCallbackURL`, and products verify them through `parseAuthorizationCallbackURL` against the original protected request.

The Wallet approval screen must render product, client/native identity, exact source/callback, selected account, network, permissions, purpose and expiry before the user can act. URI resolution or an empty Wallet page is not proof of authorization.

## SDK owner actions

1. Import `encodeRequestDeepLink`, `parseAuthorizationCallbackURL` and the frozen contract from the accepted Wallet/Auth package. Do not concatenate a per-product URI.
2. Preserve EIP-1193, EIP-6963, WalletConnect and SIWE paths when Product Session is unavailable.
3. Keep the original request and pending nonce/state only in the accepted secure-storage adapter; match the exact approve/reject callback before changing connection state.
4. Run `npm run verify:no-bare-authorize --prefix packages/wallet-auth` in the release gate. Unknown/manual route-base allowlisting is forbidden.
5. Return exact source, SDK tests and public consumer evidence before `sdkConsumed` can become true.

## Android, iOS and desktop platform owner actions

1. Receive only a completed canonical URI from the shared builder. Resolve/check the registered Wallet target, then launch that exact URI without rewriting its scheme, host, path, query or payload.
2. Persist the original protected pending request before launch. Restore it across Wallet cold start, Android Activity reuse, iOS scene reuse, desktop process restart and browser round trip.
3. Wallet parses and validates the request before rendering the approval screen. Approve/reject returns the exact callback response; replay, tamper, wrong product/chain/callback/scope and expiry remain fail closed.
4. If Wallet is absent, expose the official YNX Wallet download and MetaMask/standard Wallet only where compatible; Guest/Try must retain its explicit no-account/no-balance/no-transaction/no-chain-authority limits.
5. Return emulator or device evidence for a populated review screen, approve callback, reject callback, cold-start recovery and replay/tamper negatives. “Can open URI” is insufficient.

## Current truth boundary

The protocol implementation and source gate are locally proven. SDK/platform consumption, visible Wallet review, approve/reject device callbacks, cold-start recovery, browser round trip, public deployment and all 12 product migrations remain false. No account, signature, Session or transaction success is inferred from these source tests.
