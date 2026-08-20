# YNX Mail

YNX Mail is an independent native-first Android/iOS product with an optional
Web/PWA companion and a Go service for signed, handle-based communication inside
the YNX product boundary. It does not operate its own SMTP/MX infrastructure or
claim internet-wide delivery. An optional server-side Internet Bridge can submit
outbound messages through an explicitly configured provider while preserving
provider acceptance, mail-server delivery, bounce, complaint and user-read as
distinct facts. Native setup and identity details are in `native/README.md`.

## Run

```bash
YNX_MAIL_DATA_DIR=./var/mail \
YNX_WALLET_VERIFY_URL=http://127.0.0.1:8080 \
YNX_AI_GATEWAY_URL=http://127.0.0.1:8084 \
YNX_AI_GATEWAY_TOKEN=server-side-token \
go run ./apps/mail
```

The service listens on `:8095` by default. The first start creates a Mail sender
attestation key at `$YNX_MAIL_DATA_DIR/sender.ed25519` with mode `0600`. Back up
that key with the state file; replacing it changes the Mail service identity.

The optional Internet Bridge reads four server-only environment references:
`YNX_MAIL_RESEND_API_URL`, `YNX_MAIL_RESEND_API_KEY`,
`YNX_MAIL_RESEND_FROM` and `YNX_MAIL_RESEND_WEBHOOK_SECRET`. The API URL may be
omitted to use the provider default. Submission remains disabled unless both the
credential reference and sender identity are present; signed webhook processing
remains disabled unless its independent verification reference is present. Keep
all values in the deployment secret manager and out of Git, client bundles,
screenshots, support tickets and chat.

`YNX_WALLET_VERIFY_URL` is mandatory for sign-in and recovery. Without it the
UI and health endpoint start, but Wallet authorization fails honestly. The
verifier receives the Wallet Auth v1 four-part input at
`POST /v1/wallet-auth/verify-session` and must return a live session bound to
client `ynx-mail-v1`, bundle `com.ynxweb4.mail`, the exact scope, account,
request digest and P-256 product device. Product sessions contain only a hash of
the Wallet account identifier and an opaque product token.

The browser companion receives the opaque session only as a product-specific
`HttpOnly`, `SameSite=Strict` cookie. Login/recovery JSON never returns the
token, and the Web surface does not accept the legacy Wallet query callback.
Native sign-in uses the canonical Wallet request envelope and remains
`gateway_required` until the central registry/verifier is deployed.

## State and security boundaries

- Drafts, messages, mailbox folders, delivery attempts, blocks, Trust cases,
  AI approvals, rate windows and audit records are atomically persisted inside
  a versioned HMAC-authenticated envelope. Unknown fields, a missing key for an
  existing state file or any tamper fail closed; the key and state use mode
  `0600`.
- Native delivery remains limited to existing local `@handle` identities.
  Internet addresses use the optional server-side provider bridge. Without an
  approved provider configuration they fail as `internet_provider_not_configured`;
  they are never silently treated as delivered. Provider API acceptance becomes
  `provider_accepted`, not `delivered`. Only a verified, replay-protected provider
  event may establish mail-server delivery, bounce or complaint. Open/click
  telemetry is retained only as an ignored provider event and never becomes a
  YNX user-read receipt.
- A message carries a service-side Ed25519 sender attestation. This proves the
  accepted Mail session and message metadata; it is not a personal Wallet
  transaction signature and the UI labels it as a Mail-signed identity.
- Attachments are limited to 10 MiB combined, checked against declared size and
  SHA-256, and block executable/package/HTML types. Malware scanning is not yet
  integrated.
- The local JSON state has mode `0600` but is not encrypted at rest. Message
  bodies and attachments are not end-to-end encrypted in this implementation.
  Claiming E2EE requires reviewed device-key discovery, recipient key rotation,
  multi-device recovery and ciphertext-only server persistence.
- The spam classifier is a deterministic bounded rule set, not provider-backed
  AI. Rate limiting is persisted at five sends per account per minute.
- AI context is limited to explicitly selected message IDs. Private context is
  sent as authenticated JSON `POST /ai/stream`, never in the URL query. Provider status and
  cost are shown before approval; state streams over SSE; cancel propagates to
  the provider context; apply only creates/updates a draft and never sends.

## Main states

Native Mail delivery: `delivered | failed` -> explicit retry.

Internet Bridge delivery: `queued` -> `provider_accepted | failed` ->
`provider_delayed | delivered | bounced | complained | failed`. API acceptance
is not delivery, delivery is not a user-read receipt, and terminal failures may
be retried only as a new numbered idempotent attempt.

AI: `preview` -> `running` -> `review | failed | cancelled` ->
`applied | rejected`. A cancelled job cannot be revived by a late provider
response.

Trust: `submitted` -> `appealed`; cases are visible only to the reporter and
the message sender.

## Internet Bridge operations

The provider webhook target is `POST /v1/providers/resend/webhook`. It accepts a
bounded raw body only after timestamp-tolerant HMAC verification. Provider event
IDs are persisted inside the authenticated Mail state, so replay remains
idempotent across restart. Older out-of-order events cannot downgrade a newer
fact. The public health response reports configuration capability only; it does
not claim sender-domain verification, delivery reputation, mailbox placement or
internet-wide availability.

Before enabling outbound Internet Mail, an operator must independently verify
the sender domain, DNS records, webhook endpoint, abuse desk, bounce/complaint
handling, suppression policy, retention rights, rate limits, regional/legal
requirements and provider terms. These are external release gates, not facts
created by setting environment variables.

## Verify

```bash
npm test --prefix apps/mail
npm run build --prefix apps/mail
npm run smoke --prefix apps/mail
npm run package:desktop --prefix apps/mail
npm run proof:desktop --prefix apps/mail
npm run build:android --prefix apps/mail
npm run check:ios --prefix apps/mail
go test ./internal/mail ./apps/mail
```

Browser proof requires the bundled Playwright dependency exposed through
the product package; run `npm run browser:proof --prefix apps/mail`. The checked-in proof script launches its own ephemeral Wallet
verifier and Mail server and writes desktop/mobile screenshots under
`apps/mail/tests/artifacts/`.

Account endpoints are `GET /v1/account/export` and `DELETE /v1/account`; deletion
requires the exact phrase `DELETE MAIL ACCOUNT`, revokes sessions, removes live
account content and retains only a minimal audit tombstone.

`package:desktop` creates an unsigned macOS/Linux archive with the exact Git
commit, build time, install instructions, Go build SBOM and the applicable
`golang.org/x/crypto` license. `proof:desktop` extracts that archive into a clean
install directory, starts the packaged binary, verifies the embedded Web UI and
health/version boundary, stops it, restarts it, and emits a JSON evidence file.
