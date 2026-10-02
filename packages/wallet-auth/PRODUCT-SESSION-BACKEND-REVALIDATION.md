# Private Product Session after-await revalidation

Initial authorization remains `productsessionv2.Client.Authorize`: a fresh device
proof for the original introspection body is consumed once. Action signatures
remain the existing generic exact-action proof; room, audience and actor checks
remain the product server's responsibility. Never send a business signature to
an introspection route or reconsume the first introspection proof.

For the Social server only, construct
`productsessionv2.NewRevalidator(existingClient, keyID, ed25519PrivateKey)` and call
`Revalidate(ctx, originalVerifiedSession, serverRouteScopes)` after every await
before a state-changing commit or release of private data. Pass the complete
original verified session, not a browser-provided replacement. Scopes are chosen
by the server route. Returned session must equal the complete original binding,
account, tuple, device, scopes and absolute expiry. The result contains no token
or newly granted permission. The Go result is detached from caller-owned slices.

The fixed confidential route is
`POST https://wallet-auth.ynxweb4.com/v2/browser-sessions/product-revalidate`.
It accepts exactly `{clientId, requiredScopes, session}`. The only admitted
backend client is registered Social `ynx-social-v1-sso-v1`, corresponding to
private client `ynx-social-v1`, web platform and exact
`https://social.ynxweb4.com` origin. It uses the existing independently provisioned
Central Ed25519 backend key, key ID and `X-YNX-Backend-Proof` contract. Every read
requires a newly generated 32-byte nonce, original issuer/audience, exact method,
path, canonical body SHA and timestamp. Reusing even an identical successful
backend nonce is refused. Origin, Cookie and browser fetch metadata do not grant
server access. Missing backend configuration fails closed; no browser fallback.

The route reads the existing private Product Session authority. It checks the
original durable clock floor, complete stored session, expiry, session/device/
account cutoff revocations and schema-three pending control intents. It neither
writes private state nor issues a session, extends expiry, renews identity,
changes activity, creates an account or changes a Matrix mapping. The existing
Central authenticated nonce ledger records the server proof. The private reader
retains existing protected file identity and snapshot checks.

**This does not validate a Central actor generation.** Private Product Session
v2 has no Central generation field. Independently repeat the original live
Central/BrowserSSO VerifyBinding for the same original actor and generation after
an await, then verify the live product session and current server-side audience.
Do not silently relink a private grant to a new Central family. A definitive
private expired/revoked/missing session returns 401; changed binding/scope returns
403. Temporary state/clock/backend authentication/config/network failures remain
recoverable 503 without deleting user identity or claiming revocation.

This read is not a durable business commit fence. The product must preserve its
existing actor/audience revision, transaction record, exactly bound action proof,
replay reservation and lost-response recovery across restart. It must not commit
based solely on a prior successful read or a cached fixture. Original Social
server owns those transaction boundaries; shared code does not add a second
relationship or refresh store.

Source tests use isolated software QA keys and actual mounted Node HTTP. The Go
interop test requires an explicit exact `YNX_QA_CENTRAL_SOURCE` source directory,
uses the existing registry and PKCE-independent private Wallet approval pipeline,
consumes the original device proof, repeats confidential reads, performs a real
HTTP revoke and verifies rejection. No production keys, Wallet profile, user
DB, homeserver credentials or deployment are used. A production Social backend
key/config registration and original live actor integration remain required.
