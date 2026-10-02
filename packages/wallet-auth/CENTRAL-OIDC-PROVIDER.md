# Central OpenID provider source contract

This implementation is disabled unless an operator explicitly provides a protected RP configuration to the existing Central browser authority. It implements authorization-code OpenID Connect for one fixed confidential Synapse RP. It does not establish production homeserver ownership, create Matrix users, issue Matrix credentials, or implement Matrix device revocation.

## Routes and credentials

Issuer: https://wallet-auth.ynxweb4.com. Routes: /.well-known/openid-configuration, /oidc/jwks, /oidc/authorize, /oidc/token and /oidc/userinfo. Metadata advertises only implemented code/S256/client_secret_basic/RS256/UserInfo capabilities. Responses are no-store and no-referrer. Interactive authorization has the original Central frame-ancestors none policy.

The daemon accepts YNX_CENTRAL_OIDC_CONFIG_FILE only with explicit YNX_CENTRAL_BROWSER_SSO adoption. The exact protected JSON fields are schemaVersion (ynx-central-oidc-rp/v1), clientId, redirectUri, clientSecretFile, signingKeyFile and keyId. Config, secret and dedicated RSA private key must be process-owned, single-link regular files with no group/other permissions beneath protected non-symlink ancestors. The secret is 32–256 printable non-space ASCII bytes. RSA requires at least 2048 bits. No credential bytes belong in source, browser bundles, cookies, logs or receipts.

The redirect is one canonical HTTPS URL ending /_synapse/client/oidc/callback, without port, credentials, query or fragment. It must be the operator-confirmed HS callback, not the Social frontend callback or a QA homeserver. The RP client ID is distinct from product identity client IDs. No redirect wildcards or dynamic browser registration exist.

## Original identity and approval boundaries

Authorize validates exact client, redirect, response type code, openid with optional profile, state, nonce, S256 challenge and supported prompt/max_age. It uses the original Central session and requires Social in the actual Wallet-approved registry profile. An old three-product profile cannot acquire Social by calling this endpoint. Interactive login and forced reauthentication use the original Wallet challenge, browser transaction cookie, complete/cancel and signed full profile. The challenge state is a digest of the entire normalized OP request. Cancellation remains confirmed by the original server challenge cancellation before returning access_denied to the fixed RP with its original state.

The ID Token sub and protected ynx_account are the original canonical Central account; ynx_generation is its original generation. sid identifies the exact original Central session. No MXID/localpart is derived here. The homeserver must resolve its existing external-ID mapping with independently verified provenance; disabling registration and allow_existing_users are not proof of that mapping.

## Tokens, state and recovery

A code lasts at most 60 seconds and original Central absolute/idle limits. PKCE and confidential Basic authentication are both required. A successful token response includes a genuine separate opaque Access Token, Bearer token_type, expires_in, RS256 ID Token and scope. Both expire at the earlier of five minutes, original two-hour absolute or original thirty-minute idle limit. The original lifetime is not reset. UserInfo revalidates current session/generation/actual Social consent and does not update idle activity.

Code and Access Token records are purpose-tagged ynx-central-oidc-code/v1 in the existing store codes/grants arrays. Original schema 1/2, durable transaction, clock high-water, capacity and pruning remain in force. Original product identity endpoints explicitly reject OP records; OP endpoints reject original code/grant purposes. Code consumption, Access Token hash and signed ID Token are committed in one original transaction. After an uncertain response following commit, retrying the same code is rejected; a new explicit RP authorization intent can use the still-valid original session. No second refresh store, OAuth refresh grant or fabricated idempotent token success is introduced.

Central logout and generation rotation immediately prevent code redemption and UserInfo access for the revoked session. A different same-account browser session remains independent. An already issued offline JWT cannot be recalled solely by these checks. Backchannel logout delivery, actual HS support and device-specific revocation are not implemented or advertised. Production acceptance requires their explicit reviewed integration; Matrix logout/all must not substitute because it deletes unrelated device/key state.

## Build and rollout gates

Source tests exercise the original Wallet secp256k1 approval, actual Central routes, separate RS256 JWT/JWKS verification, actual mounted ProductSessionGatewayNodeHost HTTP, strict confidential/PKCE negatives, cross-purpose rejection, legacy signed profiles, original cancellation, same-account isolation, generation revocation, schema 2 restart and uncertain delivery. Isolated loopback HTTP is engineering evidence, not deployed HTTPS/HS/Matrix acceptance.

Before activation: independently review exact source; rebuild the existing /sso/browser.js generated closure (source changes alone do not update that bundle); use existing protected backend config/state and guarded schema-2 readers; obtain fixed real HS/RP and existing MXID provenance; pin dedicated public JWKS/signing-key lifecycle and exact deployment files; verify actual TLS discovery, code/token/UserInfo flow and original Matrix identity/device/history. Keep the feature off when those inputs are unknown. Do not point a template at a QA HS, replace user identity, enable automatic registration, clear state or fall back to a schema-1-only reader after migration.
