# Social empty-QA and protected chat candidate

Status: SOURCE_AND_LOCAL_TEST_CANDIDATE. Public, installed Wallet, real browser
IndexedDB and production acceptance remain NOT_VERIFIED. No deployment lease is
requested or consumed by this source handoff. Release/build remains Central/A.

Owner branch: codex/social-sso-chat-20261002.
Parent: 877c990484860a9733cfbeb4d29fb5c067c52814, retained without rewriting.
This incremental commit is bound by its Git commit/tree and the sibling SHA256
inventory. The predecessor source inventory remains independently committed.

## Explicit permissions and first-use flow

Identity-only consent remains account:read + profile:link. Private Social chat
requires explicit consent to the exact sorted set: account:read, profile:link,
social.contacts, social.messaging, social.profile. Purpose and buttons explicitly
describe profiles, contact requests and encrypted chat, not payments or recovery.
Native People/Alerts use the actual contacts scope, not inferred identity access.

Web controller and normal form handlers support: empty profile setup; handle
contact requests; incoming accept/reject; outgoing withdraw; accepted-contact
conversation creation; encrypted first message and message readback. Existing
Chat/Square/API and cryptography are reused. No relationships, conversations or
message success objects are seeded to manufacture success.

The original Square API returns a blank profile record for an unset profile;
blank handle/displayName enters setup. A 404 compatibility response also enters
setup, while authorization failures remain errors. Contacts and conversations
are refreshed through the actual original API. Legacy contacts/feed remain.

## Web device protection and recovery

New chat-device carriers use AES-GCM authenticated encryption and a persisted,
non-extractable WebCrypto CryptoKey in same-origin IndexedDB. Authentication
binds exact HTTPS Social origin, account and device ID. Raw seeds are not stored
as plaintext JSON in the new carrier. Ciphertext and key are inserted together;
committed readback is required before using a newly inserted carrier.

Legacy plaintext carriers block automatic creation/migration. The visible
protection action requires explicit confirmation. Exact old JSON, including
original seeds and unknown fields, is encrypted and read back before a
compare-and-delete cleanup of the old plaintext record. Interrupted cleanup is
retryable; tampering, missing keys, wrong account/origin and readback failure do
not silently mint substitute identity keys. No administrator key import exists.

Limits: this is browser at-rest and key-export protection, NOT hardware-backed
storage or protection against malicious same-origin JavaScript/XSS. Existing
Noble operations need decrypted seed strings in active JavaScript memory;
temporary byte buffers are cleared, but immutable string forensic zeroization
and erasure of browser backups/WAL are not guaranteed. Logout clears workspace
references and revokes authority while retaining protected devices for recovery.

## Inherited local test results

The following completed successfully before this evidence-only freeze:

```sh
npm run typecheck --prefix apps/social
npm test --prefix apps/social
apps/social/node_modules/.bin/tsx --test apps/social/web/chat-workspace.test.ts apps/social/web/protected-chat-devices.test.ts
node --test apps/social/web/*.test.mjs packages/wallet-auth/test/social-central-browser-session-registry.test.mjs
go test ./internal/social ./internal/productsessionv2 ./cmd/ynx-sociald
```

Native/crypto/API: 38/38. Web workspace/protected storage: 9/9. Web provider,
private-session and registration: 38/38. Go packages: pass.

The empty-QA journey starts business state empty in the original Go Social
server and uses actual SocialAPI, workspace, existing Noble crypto and outbox:
profile setup -> rejected request -> withdrawn request -> accepted request ->
new conversation -> encrypted send -> peer decrypt -> cold restore -> logout
and proof rejection -> new explicit approval -> same keys/history recovered.
The separate permission test rejects inferred contacts authority.

Synthetic boundaries: Central issuer/approval decisions and QA cookie jars are
test doubles; secure device persistence tests use actual Node WebCrypto and
structuredClone in-memory carriers, not real browser IndexedDB. These are NOT
actual Wallet approvals, DOM-click browser QA, production bundles or public E2E.

## Required release/runtime gates

Central/A must build the exact frozen source with the predecessor build contract
and an independently authorized release. Validate real secure-origin IndexedDB
CryptoKey persistence/failure handling, cold/second browser sessions, two fresh
QA accounts through actual UI and immediate explicit Wallet confirmations,
permission rejection/logout/reapproval, no blank tabs and console diagnostics.
No source/test success should be reported as public product completion. Account,
signing and transaction requests remain forbidden to this source owner.
