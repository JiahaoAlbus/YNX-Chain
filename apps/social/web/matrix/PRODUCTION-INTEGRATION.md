# Social Matrix production integration contract

This is the Social product source contract, not a deployment, homeserver setup,
real SSO receipt, device-revocation receipt or two-user E2EE acceptance.

## Existing authority and routing

Preserve the inherited `cmd/ynx-sociald` BrowserSSO, ProductSession v2,
Chat/Square persistent composition and optional Cloud-object authority routes.
Do not replace it with the legacy v1-only server from a different checkout.
No shared Auth/global route or deployment configuration is changed here.

- `POST /social/v3/matrix/login-metadata` accepts exactly one `deviceId` field,
  the protected existing browser device identifier. Query fields are forbidden.
- `GET /social/v3/matrix/peer?account=<canonical YNX address>` requires one exact
  account parameter and a currently accepted, unblocked Social contact.
- Both require a fresh proof for the exact `social.contacts`, `social.messaging`
  introspection scope array. Its body digest must not be changed to three scopes.
  `social.profile` must also exist in the verified live session.
- Web additionally requires the existing same-account, current-generation SSO
  cookie; POST requires the exact Social Origin and existing SSO CSRF header.
  Cookie-only identity login is never messaging consent.
- Responses contain only `protocol`, `account`, `homeserver`, `serverName`,
  `userId`. Protocols are `ynx-social-matrix-login/v1` and
  `ynx-social-matrix-peer/v1`. They never issue or return Matrix credentials.
- `/social/v3/matrix/session` is NOT mounted. Do not wire the historical token
  issuing MatrixBridge into the production flow.

## Existing MXID directory supplied by the deployment owner

`YNX_SOCIAL_MATRIX_DIRECTORY` selects an operator-controlled public JSON file.
The schema is `ynx-social-matrix-directory/v1` with a `bindings` array of exact
`account`, `homeserver`, `serverName`, `userId` objects. The loader validates
secure root URLs, server-matched MXIDs, unique accounts and unique full MXIDs.
It snapshots that map at process startup. It never writes business state.

The deployment owner must establish each entry from the actual production
HS/OP/RP/external-ID binding for existing users, not use test fixture identities
or guess `@<account>:<server>`. A historical localpart is preserved exactly.
Multiple actual homeservers are supported. No HS/OP/user is created here.
Configuration is bounded to 128 KiB and 1,000 explicit bindings; this carrier
does not claim to be an unbounded external identity directory service.

Absent configuration returns 503; an absent account mapping returns 409 with a
next step, never registration or a replacement device/room/identity. Existing
Social/Cloud business state remains operational. Directory changes require an
explicit owner-reviewed restart preserving existing account/MXID bindings.

## Standard SSO and the independent callback closure

The actual fixed HS must advertise `m.login.sso` and `m.login.token`. Only an
explicit Continue click opens its SSO redirect. The real Synapse RP uses its
registered `/_synapse/client/oidc/callback`, separate from Social callbacks.
Its provider must be existing-user-only; do not silently provision accounts.

The standard browser login consumer exchanges the upstream login token with
the original `device_id`, checks returned user/device and actual `/whoami`,
then connects the existing Rust crypto SDK using the exact metadata MXID.
Protected wrapping storage, sync/crypto database prefixes, storage key, rooms,
Megolm history and encrypted attachments remain unchanged. No history migration,
secret reset, admin/AS token, password protocol or plaintext fallback is added.

- Mount `/matrix/login/callback` to `dist/matrix/login-callback.html`, not the
  complete chat SDK/SPA entry.
- Serve `/matrix/login-callback-entry.mjs` as JavaScript and retain the existing
  `/assets/ynx-logo.png`. The callback closure has no chat SDK, WASM or vendor.
- Server/proxy must set `Cache-Control: no-store`, `Referrer-Policy: no-referrer`
  before content, error handling, redirects or subresources. Disable query
  logging for this callback in access logs, proxies, APM and error telemetry.
- CSP must permit the single exact inline bootstrap hash/nonce and same-origin
  callback module/image. Never allow third-party analytics/resources here.
- The head bootstrap scrubs query/hash before imports/images. Token and state
  remain only in a local memory closure and are passed once to the original
  exact-origin opener. The opener validates source window and active nonce.
- English remains default; explicit language is inherited only from the exact
  same-origin original Social window. Callback uses existing Social blue
  `#0839c7`, font stack and undistorted real YNX logo.

## Required real acceptance owned by integration/release QA

Engineering fixtures cannot prove any item below. Use two separate existing QA
users/profiles from the formal Social entry, not duplicate actors or seeded
rooms. Confirm real YNX login and explicit restricted chat approval; accepted
contacts; cross-server encrypted room invite/join; reject/unverified-send denial
then real bidirectional SAS; both-way text and encrypted attachment readback;
original-device history/attachment recovery after close/reopen and offline
recovery; account switch/logout/late-result isolation; real device addition,
verification and advertised UIA-backed deletion; revoked-device HTTP 401 and no
new Megolm sharing while remaining devices continue sending.

Production YNX session expiry/logout must have an explicit integration contract
with upstream Matrix session/device revocation. Local UI lock or a still-valid
Matrix `/whoami` is not proof of that contract. Real device delete/401/new-key
exclusion require runtime evidence; a synthetic DELETE fixture is insufficient.
MONSTER remains NOT_RUN until an actual authorized entry exists.

## Reproducible engineering commands

`GOTOOLCHAIN=auto go test ./internal/social ./cmd/ynx-sociald`

`node --experimental-vm-modules --test apps/social/web/matrix/*.test.mjs`

The callback test builds only its closure in a fresh temporary directory. Do not
run `web/build.mjs` over someone else's `dist`. Full product build, production
configuration, source-bound deployment and real-user acceptance remain with the
single authorized integration/release owner.
