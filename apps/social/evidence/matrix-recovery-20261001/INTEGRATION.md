# Social recovery and device reauthentication freeze

Parent source: bd55eaa574a1a6da354fb4399608aa9f7637e56d.
This supplements matrix-v1-20261001/INTEGRATION.md; bridge endpoints and existing YNX authority remain unchanged.

## Cold verification correction

The frozen implementation used MemoryStore for ordinary SDK sync while retaining Rust crypto keys. Browser restart lost the sync checkpoint. Actual diagnostics showed previously completed verification replayed into Requested and then Cancelled when another request arrived. With SDK IndexedDBStore keyed by canonical account/device and durable per-sync save, the otherwise unchanged scenario passed new repeat request plus explicit user rejection on both peers. This establishes the lost-sync-state defect and fixes the observed reproduction; it is not a full audit of every Rust cancellation path.

SDK cache startup finishes before Rust init/startClient. All asynchronous connection generation fences remain. The SDK cache is separate from wrapping/crypto and old v2 data. Default SDK degradation tries to clear cache; this consumer prevents that clearing and locks the affected session on degraded/closed rather than silently continuing in memory. Existing cache/keys are retained; no clearDatabase/deleteAllData/reset-cross-signing repair is used. Standard SDK raw sync cache is not a hardware or same-origin XSS boundary. Permissions still control access; account/device namespacing is not authentication.

## A-owned existing-identity reauthentication contract

MatrixSocialTransport accepts optional reauthenticateDevice({deviceId, account, challenge:{session, flows}}).

- This is NOT an endpoint issuer and does not authenticate a YNX account. A must provide an adapter backed by existing live YNX Browser SSO + explicit Social grant + route proof + current identity generation + exact origin + mutation CSRF.
- Canonical account must match the active product session. DeviceId is the device being removed, not an account selector. The fixed registered HTTPS homeserver binding remains authoritative.
- Actual upstream DELETE device first obtains a real UIA challenge. Callback is invoked only for a 401 containing a session and advertised supported stages. There is no synthetic challenge or local trusted-device flag.
- Adapter must complete an actual homeserver-supported delegated SSO/UIA flow for that challenge, bound to current user, upstream session, device-removal action, origin and short expiry; return the SDK-supported auth object with exact same session and type advertised in flows.
- Standards-supported m.login.sso interactive completion, if offered, must complete with the operator's UIA mechanism. Do not invent a one-shot ticket schema, bypass through an application-service token, or create a second password account. Exact route and issuer schema stay A-owned pending actual selected homeserver support.
- No UIA stage available means configuration/issuer blocker. Empty stages or mismatched session/type never retry DELETE. Default ordinary web integration supplies no issuer hook, so removal honestly fails closed.
- Callback waits are generation-fenced before retry; SDK DELETE targets the captured client only. Success requires actual upstream device-list removal and old token invalidation readback, not merely callback success.
- Public diagnostic event exposes deviceId/status/advertised flow stages only. UIA session, auth payload, token and private keys are not published or included in receipts.

Observed private Synapse AS-only QA 401 parsed challenge advertised flows: []. Therefore this run cannot validate delegated production identity reauth, removal, token invalidation or post-removal send. A must select/configure the existing YNX delegated identity mechanism supported by the production homeserver and provide its real UIA stage before this gate can pass. Do not weaken the gate.

## Actual results

- node --test apps/social/web/matrix/transport.test.mjs apps/social/web/matrix/device-reauth.test.mjs: 13/13 PASS. Includes startup-generation race, changed-device discard/block, no-hook UIA block, exact-session reauth callback, stale-account reauth rejection, wrong stage rejection. Synthetic callback tests are policy tests, not real identity authentication evidence.
- Social typecheck PASS; Go internal/social + internal/chat PASS.
- federation.json: ten actual isolated browser/two-homeserver checks passed, including initial explicit rejection and cold-restored repeat explicit rejection. console-pageerror-zero is Playwright pageerror only, not complete browser console/network error absence.
- device-reauth.json: four actual checks passed (trusted send, new peer device discovery, changed/unverified device send blocks, confirmation requirement); confirmed deletion FAILED closed due to 401/no advertised stages.
- Older failed receipts retained. Fresh tests use disposable accounts; each cold recovery uses the same original device/profile/keys. No secret/private runtime files committed. Own containers/network stopped; profiles retained privately.

## Remaining false and rollback

Production bridge mounting/YNX SSO issuer integration, normal product public journey, Native, verified new-device history/backup, actual revocation/token invalidation/key-exclusion and post-revocation recovery remain NOT_VERIFIED. Original broad Web failures remain unresolved; this targeted segment does not claim full-suite green.

A is sole integration/build/release owner. No deployment or user account/sign/chain transaction occurred. Disable bridge/panel or restore the exact preceding release through A's separate lease; preserve old v2, Matrix wrapping/crypto and new sync cache records. Do not delete caches or rotate identity to roll back. Writer2 is released after this freeze; source writes require next explicit rotation.
