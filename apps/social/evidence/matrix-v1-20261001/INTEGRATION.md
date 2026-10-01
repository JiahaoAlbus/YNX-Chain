# YNX Social Matrix first vertical candidate

Status: NOT_COMPLETED. No public deployment, real Wallet sign-in integration,
Native Matrix runtime, full recovery, independent-operator production federation
or MONSTER acceptance is claimed. Source parent is
6f6843dd552ed69ec1735da678930d642271ceb3, tree
37c0bd427cfaf171e81b9fa7620be96a2bfd5551. Existing legacy v2 decoder, encrypted
messages, devices and outbox were not modified or reinterpreted as Matrix.

## Implemented source

- Fixed matrix-js-sdk43.0.0 Apache-2.0, locked Rust crypto WASM18.9.0 Apache-2.0;
  matrix-encrypt-attachment1.0.3 Apache-2.0; QA playwright1.63.0 Apache-2.0.
  package-lock fixes exact resolved packages. Node22+ required by the JS SDK.
- Web Matrix adapter uses the maintained SDK/Rust crypto, not a new ratchet.
  New rooms carry protocol ynx-social-matrix/v1 and m.megolm.v1.aes-sha2 state.
  Legacy rooms are neither silently upgraded nor reencrypted on the server.
- Standard SAS request/accept/compare/explicit confirm/mismatch/reject controls.
  No setDeviceVerified shortcut is used to manufacture test trust. Sending requires
  every encryption device to be verified; directory keys alone are not trusted.
  Cross-signed-device automatic trust is disabled. First-device SDK cross-signing
  is bootstrapped only if no existing user identity exists; new devices do not
  reset an existing identity. Initial upload reauthentication must be supported
  by the upstream issuer; no password/admin-secret import or UIA bypass exists.
- Receiver only exposes SDK decrypted content with shieldColour NONE(0).
  GREY/RED/null instead return an authentication-warning placeholder without
  calling getContent or giving the UI attachment keys. Unencrypted messages are
  not displayed in this new path. Unknown/undecryptable events are retained at
  the SDK/server layer, not filled with fabricated history.
- Every asynchronous transport operation captures generation/client/binding and
  guards its results. Old trust/media/send/create/join/read/revoke/verification
  results are discarded after stop/account replacement, without automatic resend.
- Standard encrypted attachments are uploaded as application/octet-stream with
  no filename; encrypted room events contain their descriptor. Media metadata,
  graph, account identifiers, sizes/timing still are not anonymous.
- SDK IndexedDB crypto storage is encrypted using a random store key protected
  with a persisted non-extractable WebCrypto wrapping key. Namespace is distinct
  from old v2 stores. This does not resist same-origin malicious JavaScript or
  OS compromise. Active buffers still require memory, not hardware isolation.
- New normal Web panel requires existing YNX sign-in and explicit five-scope
  Social consent, offers peer binding, invitations, SAS, messages, attachments
  and device removal. No registration/password form is added. Matrix sessions
  are locked if periodic/current-operation identity checks fail. Standard Wallet
  is not changed. Production bridge is intentionally NOT_MOUNTED in this commit.
- Backend MatrixBridge accepts the existing authenticated account, fixed operator
  resolver and credential issuer, validates upstream whoami user+device, never
  accepts account/homeserver/token from client JSON, never returns issuer tokens
  on mismatch, and uses bounded body/response plus nonredirecting timed requests.
  Peer resolution also requires a real accepted-contact check, otherwise403.

## Exact A-owned mounting/authority contract

No shared/Auth/main source was changed by this owner. A must integrate the
following after this source freeze, through the current authority, not a new
identity issuer:

1. Mount *social.MatrixBridge on exactly POST /social/v3/matrix/session and
   GET /social/v3/matrix/peer?account=<canonical-YNX-address> inside the existing
   Social route boundary. No public anonymous or application-service token route.
2. Authorize(request,[social.contacts,social.messaging]) must verify the existing
   host-only Social BrowserSSO grant, current shared Product Session route proof,
   same canonical YNX account, live grant/generation/expiry, exact origin, and
   mutation CSRF; never infer private permission from the identity-only grant.
   Origin/CSRF enforcement belongs to this callback before credential issuance.
   Preserve authority/TLS failure fail-closed and Standard Wallet separation.
3. Resolve(context,account) supplies fixed registered homeserver base HTTPS URL
   and Matrix serverName. Canonical transport alias is
   @<canonical-YNX-account>:<registered-serverName>. It must come from verified
   backend account/operator binding, not a server selected by client input.
   No new chain writes/private keys/messages are introduced by this bridge.
4. Issue(context,account,deviceId,server) issues a user-scoped credential through
   the chosen operator's supported SSO/delegated auth integration. Credential
   ExpiresAt must truthfully match upstream expiry, not cosmetically relabel a
   permanent token; callback must support same-device resume and revoked devices
   must not be recreated silently. Never ship AS/admin tokens to browsers.
   Tie actual credential expiration/revocation to Central consent and provide
   SDK-standard initial cross-signing/device-removal reauthentication, without
   asking for another password. The current local UI check alone does not revoke
   a previously issued upstream bearer token.
5. AllowPeer(context,actor,peer) must verify existing accepted contacts and block
   revoked/blocked relationship access; no callback or denial produces403.
6. Session input is only {deviceId}. Output is protocol/account/homeserver/
   serverName/userId/deviceId/accessToken/expiresAt, Cache-Control:no-store.
   Peer GET returns only verified mapping, never a token. Authorization should
   remain fresh for both operations; credential/body/proof must not enter logs.
7. Fixed production homeserver list must accept exact client origins/CORS and
   authenticated media and allow standard federation with other registered
   independent operators. Do not copy local QA IP/CA exceptions into production.

A build contract: existing apps/social root, locked install, web:build, web/dist.
The source build script adds matrix-session-ui.js plus self-hosted
pkg/matrix_sdk_crypto_wasm_bg.wasm from the locked dependency. The source owner
DID NOT run a production build. A must hash exact WASM/output bytes and inspect
browser bundling, privacy headers/CSP WASM policy and reverse-proxy routing.
Do not weaken CSP broadly to hide an integration failure.

## Local QA and evidence classification

The QA runner uses two separately configured Synapse containers with distinct
server names, signing keys, SQLite stores and TLS certificates under a temporary
CA. Official image is pinned:
ghcr.io/element-hq/synapse@sha256:38879c6039381b9b66a2adb11b92c63dd5f7ee6a443b98d1edf10ffe004e17e4
Client ports bind127.0.0.1 only; registration is disabled except private QA AS
provisioning; federation is TLS-verified and allowlisted to these two test domains.
Credentials/CA private material are generated exclusively for local QA, retained
in owner-only temporary runtime files and NEVER committed. No real administrator
key, live user key/message/account or public chain is used. Both containers live
on this same host: this tests cross-server federation, NOT independent production
operators or decentralization/availability guarantees.

The browser runner launches its own isolated headless Chromium processes/profiles
and test-only temporary bundle, not the user's Chrome or a production artifact.
It uses actual Matrix JS/Rust crypto, actual homeservers and standard SAS, with
synthetic AS account provisioning instead of the production YNX Wallet bridge.
An encrypted-server readback is required before message success is recorded.
Exact current pass/failure details are in the sibling runtime evidence JSON;
failed runs are retained, not relabeled passed. Final evidence must be read against
its recorded checks, not inferred from script intent.

Executed source checks: Social typecheck PASS; inherited Native/API/crypto38/38
PASS; new policy/generation/receiver tests6/6 PASS; Go internal/social and
internal/chat PASS. The six checks include deferred trust and attachment-upload
account replacement, and GREY/RED no-plaintext/no-attachment-key receiver tests.
No source check alone proves the full real-user journey.

## Remaining work in the same Social objective

Production mount and supported same-account delegated token+revocation/UIA are
not implemented here. Two real YNX Wallet users through normal UI, source-bound
public runtime and 6423 lifecycle are still unverified. Native React Native/Expo
cannot be labeled compatible merely because the browser SDK works: the current
IDB/WASM adapter is Web only. Matrix Rust SDK native bridge/development-build
support and native protected persistence require a later owner window; existing
Native legacy chat remains intact, not mislabeled standard federation.

Device-add/change/remove, complete normal UI assurance and media failure paths
must match actual recorded QA results. Standard encrypted backup/new-device
verification, lost-device recovery, durable new-protocol pending-send restore,
long-history pagination, metadata minimization, central revocation of all Matrix
credentials, independent operator federation and security/platform review remain.
Megolm must not be advertised as identical to per-message Signal PCS. Federation
does not erase membership, account correlation, size, timing or IP metadata.
No claim of stronger privacy than Telegram is supported.

Rollback: do not reset user databases, seed carriers, profiles, old outbox or old
messages. Disable the new panel/bridge configuration or deploy the prior exact
6f6843dd consumer through A's separate lease while retaining the Matrix namespace
and opaque server history for recovery. Do not silently resend Matrix messages
using v2 or import/reset keys to manufacture success. A owns deployment artifact
and precise production rollback identity; neither is created by this source owner.

Official references checked this turn:
https://github.com/matrix-org/matrix-js-sdk
https://github.com/matrix-org/matrix-sdk-crypto-wasm
https://github.com/matrix-org/matrix-rust-sdk
https://github.com/matrix-org/matrix-encrypt-attachment
https://spec.matrix.org/latest/client-server-api/
https://spec.matrix.org/latest/server-server-api/
https://github.com/element-hq/synapse

Brand/UI update in this freeze: approved original YNX PNG (SHA256
38196080c2d56746fb37094abe68d1d89eabd8a2b29ab4f17bae48ac7e3effde)
replaces active Y placeholder in header/favicon/YNX chooser/connected indicator;
contain scaling, no imagegen or redraw. Existing blue/white CSS variables style
all added controls and responsive/focus states. CHECKS.md records current broad
Web test failures; this is not a universally green or production-ready candidate.
