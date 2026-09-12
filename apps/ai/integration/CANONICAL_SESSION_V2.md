# AI canonical Product Session v2 integration

The AI service consumes `internal/productsessionv2` from coordinator source
`0b3761f903ffd5dee6367e49c613cfd8752d7562`. The adapter owns the HTTP verification
contract with Wallet. AI does not issue replacement canonical bearer tokens.

Set `YNX_AI_WALLET_GATEWAY_ORIGIN` to the actual registered HTTPS Wallet authority
origin when configuring the service. There is no guessed default. Configuration
rejects non-HTTPS origins and simultaneous `YNX_AI_ALLOW_LOCAL_FIXTURE_AUTH=1`.
The fixed AI Web policy uses the identifiers in `product-session-v2-candidate.json`,
with Web application ID `com.ynxweb4.ai.web` and callback
`https://assistant.ynxweb4.com/wallet-auth/callback`.

`GET /api/wallet/config` exposes the public binding, configured authority origin,
proof header and configuration flag. `canonicalConfigured` reports a configured
client, not remote registration, availability or completed public acceptance.

The browser must obtain a new SDK `createIntrospectionProof(scopes)` for each
request and send `proofHeader` as `X-YNX-Product-Session-Proof-V2`. It must not
consume that proof at the authority first. Do not also send a legacy bearer or
v1 proof header. AI chooses the scopes from its existing server routes:

| Route family | Required scope |
| --- | --- |
| Session readback, conversations | `ai:conversations` |
| Provider and generation | `ai:generate` |
| Attachments | `ai:attachments` |
| Permissions and action reviews | `ai:permissions` |
| Usage, audit, privacy, export, appeals | `ai:data-control` |

Each call verifies a fresh remote response, preserves resource/account ownership
checks, and uses the authority's account, device and lifetime only after success.
There is no cached decision, automatic authorization retry or fixture fallback.
Authority outages return 503; invalid/revoked credentials return the adapter's
rejection status. Retries require a fresh proof and must preserve any applicable
business idempotency key.

Session readback returns no token, hash or device secret. Canonical revocation
must use the Wallet SDK's durable disconnect/revocation flow. The legacy local
`POST /api/auth/revoke` does not revoke canonical sessions and does not report a
successful canonical revocation.

The signed proof authorizes a session and server-selected scopes, not the AI
business request body. Existing explicit action review and separate Wallet
signature boundaries still apply. MetaMask standard connection is not a YNX
private Product Session.

The callback route currently serves the application shell without reflecting
query data or issuing a session. Registry publication, browser v2 completion
wiring, native integration and source-bound public acceptance remain separate
unfinished steps. Do not enable fixture auth to substitute for these steps.
