# Card business backend (development)

YNX Testnet payment simulation only. No fiat, PAN/CVV, card network, or real merchant payment capability. This server is a new Card-owned business schema, not a claim that legacy Gateway routes or a Wallet verifier have been accepted/deployed.

Run with Node 24+ and the Card development dependency runtime:

```sh
node --import tsx server/main.ts
```

Required deployment configuration (never put values containing secrets into evidence):

- `YNX_CARD_STATE_KEY_BASE64`: independently generated 32-byte AES key, base64 encoded. Not a Wallet/private key. Back it up separately; losing it makes existing state unreadable.
- `YNX_CARD_DATA_DIR`: persistent single-host volume for `card.sqlite`, WAL and SQLite files. Ephemeral function filesystems are not supported.
- `YNX_CARD_AUTH_ADAPTER_MODULE`: trusted server-side module exporting `createWalletAuthority({origin})`. The only supplied authority origin is `https://wallet-auth.ynxweb4.com`. The Wallet owner must supply/confirm the adapter. It authenticates Card audience, owner, chain, route-specific scope, expiry and revocation. Its business approval function, if any, is ignored; Card uses the fixed shared verifier described below. No permissive production authentication adapter is supplied.
- `YNX_CARD_CORE_RPC_URL`: fixed accepted HTTPS Core RPC, server-side reads only.
- `YNX_CARD_TESTNET_FUNDING_ADDRESS`: exact operator-controlled Testnet funding address. There is no embedded default address.
- `YNX_CARD_MIN_CONFIRMATIONS`: minimum accepted confirmations (default 2).
- `YNX_CARD_SOURCE_COMMIT`: exact deployed source identity; unset means unbound development.
- `YNX_CARD_HOST`, `YNX_CARD_PORT`: bind address and port. Default is local-only `127.0.0.1:3094`; production needs a controlled HTTPS reverse proxy.
- `YNX_CARD_ALLOWED_ORIGIN`: defaults to the canonical Card HTTPS origin.

Every route supplies its minimum `requiredScopes` to the accepted verifier and
checks that exact scope again before any cache lookup or mutation. There is no
conversion to broad `card.read`/`card.write` authority. Read uses `account:read`,
application actions use `card:application:write`, and controls/lifecycle use
`card:controls:write`. Funding intent/receipt routes require `card:topup:write`;
simulated merchant actions require `card:simulation:write`. These last two scopes
are included in Wallet source ff5b7d49; they are not a claim that c97f85e9 or a
live registry currently grants them. A session
without either scope is denied, not automatically upgraded.

Authentication uses only `X-YNX-Product-Session-Proof-V2`. Legacy proof and bearer
headers are rejected. The accepted adapter must forward a fresh one-time proof
to `/v2/product-sessions/introspect` with the exact route scopes. Do not consume
the proof in a browser preflight or reuse it on retry. The business idempotency
key is independent of the one-time authentication proof.

Explicit application approval must bind the stored challenge and exact five
details: `nickname`, `useCase`, `limitWei`, `riskAccepted`, `termsVersion`.
Other controls are not part of that signed details digest. The adapter receives
these persisted details as the fourth `approve` argument, not a caller-supplied
substitute. Card does not recover signatures, mint Wallet sessions, implement
DeviceProof or collect keys. Absent authority is `PRIVATE_SERVICE_DEGRADED`, not
a disconnected Standard Wallet. Native YNX subjects are permitted for Card
registration; any EVM sender binding must be established by the accepted verifier,
never inferred as signing authority from an address-format conversion.

## Business routes

Public process metadata: `GET /healthz`, `GET /version`. Configuration readiness is not proof of any real Wallet approval or funding.

Authenticated routes use `/api/card/v1` and a stable `Idempotency-Key` on mutations:

- `GET /state`
- `POST /applications`, `PATCH /applications/:id`
- `POST /applications/:id/approval-request`, `/submit`, `/cancel`
- `POST /cards/:id/topup-intents`, `POST /topups`
- `POST /cards/:id/freeze`, `/unfreeze`, `/close`, `/recover`
- `PUT /cards/:id/controls`
- `POST /cards/:id/authorizations` (explicit `simulation:true`)
- `POST /authorizations/:id/capture`, `/reverse`
- `POST /captures/:id/refund`
- `POST /cards/:id/fees` (explicit `simulation:true`, reason `SANDBOX_PROCESSOR_FEE`)
- `GET /cards/:id/statement`
- `GET /cards/:id/reconciliation`

Simulation fees move available Testnet wei to the separate fee ledger and are
idempotent. They are not real issuer charges. The internal `card.fee.simulated`
event is not a claim of accepted Data Fabric publication. Reconciliation checks
every ledger snapshot, non-negative conservation, authorization holds, outstanding
captures and stored funding receipt/credit bindings. It deliberately reports
`chainReverified:false` and `dataFabricReconciled:false`: local consistency is
not new on-chain confirmation or a cross-service reconciliation receipt.

Amounts are positive decimal **wei strings**, never floating-point fiat amounts. A top-up intent has an exact owner, recipient, native YNXT value, chain, expiry and confirmation requirement. Only the server Core verifier can produce a receipt used for credit. Receipt callbacks from clients are never accepted as evidence. Wallet approvals and transactions must remain explicit user actions outside this server.

State is persisted in SQLite WAL transactions; owner business snapshots are AES-256-GCM encrypted with owner-bound additional data. Wallet addresses and public transaction claim identifiers remain database metadata. Funding claims are unique across owners in the same database and committed atomically with ledger credit. Use a single persistent database, not independent replicas. Deployment/storage permissions and backups still need operational configuration.

Business events and delivery attempts persist with the ledger. `flushEvents(owner, transport)` is a trusted server-worker seam, not an end-user HTTP endpoint or Wallet scope. Its owner and transport are never client-selected through this server. Receivers must deduplicate stable event IDs after ambiguous delivery. An accepted Data Fabric transport and actual reconciliation evidence are still required; test fixture events are not public funding evidence.

This development service is not yet bound to a public deployment or to the native/Web UI. The existing tested APK is unchanged. Fixture approval/Core adapters appear only in tests. No real account, signature, transaction, or Card funding is asserted by those tests.

## Consumed Card application verifier

`walletApproval.ts` consumes the verification-only Wallet Owner ff5b7d49
artifact with its original source manifest. It calls
`verifySignedCardApplicationApproval` against the current persisted challenge,
all five details, authenticated subject and current time. Only then is the
verified account mapped to EVM and persisted as `card.fundingSender`.
Top-up intents ignore any EVM address claimed by a client or private-session
object. Existing native cards without verified sender binding remain unable to
create a funding intent.

The shared proof means approved only. An unsigned rejection does not verify as
an approval. Historical parsing cannot replace time-bound verification. The
Card API's default authentication remains unavailable until the accepted
session verifier is configured. The native review/return flow and a compatible
MetaMask business-approval scheme are not established by consuming this helper.
