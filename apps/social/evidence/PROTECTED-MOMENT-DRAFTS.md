# Original-device protected Moment drafts and text retry recovery

Baseline: f08329564433fdae83747342517c0c7152cc754b.

The normal Matrix composer now has explicit Save protected draft and Restore
protected draft actions. `protected-drafts.mjs` reads the original accounts
object store and reuses its original non-extractable AES-GCM wrapping key.
It does not generate/reset a key, create a replacement device, change the
original wrapping record, or silently switch identities. Separate composite
draft keys leave all original Matrix records and history intact.

Draft text, selection, optional original file and transaction are encrypted at
rest. Origin/account/device/transaction/status are bound with authenticated
additional data. Writes compare record revisions inside the existing IndexedDB
transaction. An unresolved delivery record cannot be replaced by a new
transaction, changed body, draft downgrade or stale actor. Corrupt records are
retained for recovery rather than erased. Explicit draft save is not autosave.

Before potential publication the original intent is durably marked uncertain;
only authenticated event readback and committed index allow the UI caller to
clear it. This conservative marker can also remain after a pre-dispatch failure:
it is not evidence that a message actually left the device. Text-only unknown
recovery rechecks current audience under the original transaction; it never
sends automatically or allocates a replacement transaction. Explicit same-ID
retry relies on the real Matrix server's transaction idempotency, which remains
a separate production acceptance gate.

Normal unsent file drafts restore from protected storage. Unknown attachment
delivery cold retry is deliberately blocked: the original encrypted upload
descriptor/result has not yet been durably integrated. Re-encrypting/reuploading
on a fresh page would substitute the original content, so it is not a safe
fallback. This remains required full-goal work, not a reduction of scope.

## Executed evidence

- Complete npm suite: 110 passed, zero failed/skipped. Two new actual UI-handler
  integration cases cover explicit draft restore without send and text-only
  unknown restoration with the same transaction. Their storage/authority/Matrix
  adapters are explicitly synthetic and not user acceptance.
- Typecheck passed.
- Actual headless Chromium, secure synthetic origin, original storage functions:
  real WebCrypto/IndexedDB save, reload, same-device/key reuse, text/file recovery,
  changed device rejection, unknown intent/body replacement rejection, stale
  guard rejection, authenticated-metadata tamper rejection and ciphertext
  retention. The standalone script is `scripts/protected-moments-storage-check.mjs`.
- Normal session-ui browser bundle succeeded (3.0 MiB). Existing five Chromium
  late-review negative scenarios reran against the new UI bundle, exit 0.
- Initial npm run failed a module transform due to the new drafts dependency
  shadowing the old local drafts Map; the Map was renamed localDrafts. The
  original 104-pass/one-file-fail log is preserved, not rewritten as success.

Evidence: `protected-moments/20261002/`.

Protection is at rest only, not against hostile same-origin code or compromised
OS. No production database/browser profile, key or record was used. No wallet
account authorization, signing, transaction or deployment occurred. Shared A's
after-await revalidation source remains unconsumed pending Central approval.
True HS/SSO/public/installed/Native/full Social v2 acceptance and unresolved
upload settlement still require direct evidence.
