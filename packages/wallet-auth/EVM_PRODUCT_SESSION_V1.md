# EVM Product Session v1 (Finance read only)

This is a separate EVM-only contract. It does not create a native Product Session v2 approval, does not convert `0x` to `ynx1`, and does not grant any native v2 scope. `providerKind` is a user-supplied display claim; it does not attest which extension is installed.

## Wire schema

All objects have exact fields; unknown fields fail. Times are canonical UTC ISO milliseconds. The package exports parsers, signers, and verifiers from its root and `./evm-product-session`.

| Object | Required fields | Limits |
| --- | --- | --- |
| Challenge | `version=1`, `chainId=6423`, lowercase `0x` EOA `account`, `productId=finance`, `origin`, `callback`, `scope=finance.account.read`, `deviceId`, `deviceAlgorithm=p256-sha256`, compressed P-256 `deviceKey` (base64url), `nonce`, `state`, `requestId`, `providerKind`, `issuedAt`, `expiresAt` | Five minutes; exact Finance origin `https://finance.ynxweb4.com` and callback `https://finance.ynxweb4.com/wallet-auth/callback` |
| Login proof | `challenge`, exact `message`, 65-byte Ethereum `walletSignature`, DER P-256 `deviceSignature` | `personal_sign` of `YNX EVM Product Session authorization v1\n` plus canonical challenge JSON; device signs a separate domain-bound copy |
| Session record | `version=1`, server `sessionId`, `challengeDigest`, challenge account/product/origin/callback/scope/device/nonce/state/requestId, `issuedAt`, `expiresAt` | Maximum 15 minutes. Server stores it as authoritative state; client JSON is never accepted as authority. |
| HTTP proof | `version=1`, `sessionId`, `challengeDigest`, `account`, `origin`, `scope`, `method`, `target`, `bodyDigest`, `nonce`, `issuedAt`, `expiresAt`, DER P-256 `deviceSignature` | Maximum 60 seconds. `target` is the exact raw path **and query**. `bodyDigest` is lowercase SHA-256 hex of exact request body bytes (empty body for GET). |

The challenge's Finance origin and callback are protocol constants, matching the registered Finance web origin and existing callback route. A later callback change requires a reviewed contract version. The Finance backend must issue and retain the exact challenge in a server authority store; it must not accept a challenge assembled by the caller as `expectedChallenge`.

The `*With` signer APIs accept a base64url P-256 signature from a browser signer. They normalize WebCrypto's 64-byte raw ECDSA output to DER before emitting a wire proof, and verify it against the bound public key. The browser should retain the private key in non-extractable `CryptoKey` storage; the secret-key helpers exist for fixtures and non-browser callers.

## Server flow

1. Generate unpredictable nonce, state, requestId, and sessionId. Check the selected account and `eth_chainId=0x1917` in the browser before signing. Generate a non-extractable browser P-256 key where available and place its compressed public key in the challenge. Show the exact challenge to the user for `personal_sign`; the browser also signs the device binding payload.
2. Load the original challenge by requestId from server storage. `verifyEvmProductSessionLoginProof` checks its exact bytes, wallet EOA signature, device signature, and time. `issueEvmProductSession` additionally requires `commit` to atomically consume the challenge nonce/state/requestId and persist the returned session. Return `true` only after both changes commit. A failed transaction must roll back both. No session is valid without its persisted server record.
3. For each private request, the Finance server loads the session by ID using `loadSession`, checks stored revocation state, and calls `verifyAndConsumeEvmProductSessionHttpProof`. Supply the actual request origin, GET method, raw path plus query, body digest, and required scope. `allowedTargets` is a **server-owned, nonempty, fixed list of read-only pathnames**; never take it from the client. A pathname not in that list fails closed. The full raw target, including query, must match the signed proof. The `consumeProof` callback must atomically insert `(sessionId, nonce)` with a uniqueness constraint and reject repeats. Authorization is valid only for the current request, after all checks pass.
4. On `accountsChanged`, `chainChanged`, or `disconnect`, the browser immediately stops using the session, clears local state, and sends a best-effort authenticated revoke. The server records explicit session/device/account revocation and rejects later requests. The `authority` fields passed to the verifier must come from fresh trusted server context if such context exists; missing/unknown account, chain, connection, or revocation status fails closed.

The server cannot independently prove the current MetaMask or YNX Wallet browser selection from `personal_sign` or device signatures. Without a received revoke or another trusted live signal, a previously issued session can remain usable until its short expiry by a holder of its bound device key. `currentAccount`, `currentChainId`, and `connected` are supplied assertions, not extension attestation. Finance integration must define how to obtain them without trusting arbitrary client fields. Until that integration exists, this package is a shared contract and does **not** change Finance's `privateFinanceAuthorized:false` result.

The only grant is `finance.account.read`, and the verifier permits GET only. Finance owns the exact route mapping and must pass only its account-read routes as `allowedTargets`; this package does not guess its private route paths. The EVM contract never grants orders, trading, payments, or native Product Session v2 authority.

`testdata/evm-product-session-v1.json` contains the fixed challenge and invalid-field vectors; `test/evm-product-session.test.mjs` derives deterministic wallet/device signatures and checks issuance, replay, query changes, route policy, account/chain changes, and revocation.
