# Product Session Gateway deployment

The implemented service is `scripts/ynx-wallet-gatewayd.mjs`. It serves the
legacy gateway and Product Session v2 on a loopback HTTP listener. Publish it
behind the deployment owner's HTTPS reverse proxy, with one process per
durable state path. This is a deployment recipe, not a claim the public
authority or any client has been connected successfully.

Install locked dependencies from this package with `npm ci --omit=dev`, then
run `node scripts/ynx-wallet-gatewayd.mjs` under Node >=22. No compile step is
required. Use an immutable checkout and the registry from the same approved
release; do not copy a registry into an older parser that cannot support it.

Configuration names (values below are deployment paths/examples, not secrets):

| Variable | Purpose |
| --- | --- |
| `YNX_WALLET_GATEWAY_HTTP_ADDR` | Loopback only; default `127.0.0.1` |
| `YNX_WALLET_GATEWAY_HTTP_PORT` | Default `6439` |
| `YNX_WALLET_GATEWAY_STATE_PATH` | Required absolute legacy state file, e.g. `/var/lib/ynx-wallet-auth/legacy.json` |
| `YNX_WALLET_GATEWAY_REGISTRY_PATH` | Exact legacy `central-registry.json` path |
| `YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH` | Exact new `product-session-registry.json` path |
| `YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH` | Separate absolute durable Product Session state file |
| `YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION` | `2` by default; `3` only with an explicitly migrated v3 state path |
| `YNX_WALLET_GATEWAY_REMOTE_DEPLOYED` | `true` only when deployment identity is configured; does not itself prove HTTPS reachability |
| `YNX_WALLET_GATEWAY_SOURCE_COMMIT` | Actual full 40-character Git SHA |
| `YNX_WALLET_GATEWAY_RELEASE` | Immutable release label |
| `YNX_WALLET_GATEWAY_BUILD_TIME` | Actual canonical ISO UTC build time |

The daemon has no static API-token or account-private-key environment variable.
It verifies protocol signatures and generates challenge/session randomness
inside the process. Never configure wallet secrets in the gateway. TLS keys
belong to the reverse proxy or managed certificate service. State includes
security-sensitive session/replay data: preserve the files and ownership across
restarts, with directories mode0700 and regular files mode0600. Do not reset a
state file to make a new release start. Use the existing backup/migration tools
and resolve registry/state compatibility before switching a live process.

Public routes to forward without redirects or body rewriting:

- `GET /health`, `/ready`, `/version` for operational identity.
- `GET /v2/product-sessions/time` with `X-Request-Id` for the gateway clock.
- `POST /v2/product-sessions/challenge`, `/complete`, `/introspect`, `/revoke`,
  `/devices/revoke` (all suffixes under `/v2/product-sessions`).
- Wallet session-control routes exported by `WALLET_SESSION_CONTROL_PATHS`;
  v3 intent routes only with the v3 host and migrated storage.
- `OPTIONS` for the registered browser origins and exact route/header set.

Forward `Origin`, `Content-Type`, `X-Request-Id`,
`X-YNX-Product-Session-Proof-V2`, and the Wallet session-control proof header
without alteration. Let the host enforce its exact origin/CORS policy; do not
add a wildcard credential policy at the proxy. Do not cache proofs, authorization
responses, or callback query strings, and do not log request bodies/headers that
contain proofs. Account and device signatures remain the authority; an allowed
Origin alone grants nothing.

The deployment owner must hand clients one fixed HTTPS authority. Configure
`ProductSessionGatewayFetchAdapter.endpoint` and each server's
`internal/productsessionv2.NewClient` with that same verified authority and the
matching registry identity. The agreed target for new consumers is
`https://wallet-auth.ynxweb4.com`; this decision is not proof the new release
and registry are deployed. A private product calls `createIntrospectionProof(scopes)`
and sends `proofHeader` to its backend, which consumes it once against the
Gateway. Session scope validation is distinct from explicit transaction or Card
application approval.

Wallet Web's `publicGatewayRegistryReady` / `trustedRuntimeAvailable` flags and
the native client's real gateway configuration must be connected only to actual
runtime support. A healthy daemon or new registry does not make an unwired PWA
able to approve requests. Verify the callback route and the Wallet approve /
reject / product-return flow after deployment. Preserve unavailable states for
the still-unimplemented native DEX/Card business-action controller.

## Existing authorities

The coordinator reported two existing services: wallet-auth at port18445 and
api/ide Product Session routes at port6441, with different source releases and
separate state. New consumers target the wallet-auth authority. Preserve both
original state stores and their backups; never merge snapshots by concatenating
JSON, clear replay/revocation history, or round-robin a session across stores.

Upgrade the wallet-auth service against its own durable state using the new
compatible registry. Keep the old authority available for its existing clients'
expiry and explicit revocation until those clients migrate. A migrated client
obtains a new explicitly approved session from the new authority; an old
session does not become valid there merely because its account matches. Do not
use HTTP redirects for protocol requests (the SDK rejects them). If old API
paths are eventually proxied to the unified service, first finish the consumer
migration and retain the old history needed for audit and revocation. This is
the agreed migration strategy, not an executed production cutover.
