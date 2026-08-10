# YNX Mail

YNX Mail is an independent native-first Android/iOS product with an optional
Web/PWA companion and a Go service for signed, handle-based communication inside
the YNX product boundary. It is not an SMTP service and does not claim
internet-wide email delivery. Native setup and identity details are in
`native/README.md`.

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
- Mail delivery is limited to existing local `@handle` identities. Domain-style
  or protocol recipients receive `internet_mail_delivery_not_supported`; they
  are never silently treated as delivered.
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

Mail delivery: `queued` (reserved) -> `delivered | failed` -> explicit retry.

AI: `preview` -> `running` -> `review | failed | cancelled` ->
`applied | rejected`. A cancelled job cannot be revived by a late provider
response.

Trust: `submitted` -> `appealed`; cases are visible only to the reporter and
the message sender.

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
