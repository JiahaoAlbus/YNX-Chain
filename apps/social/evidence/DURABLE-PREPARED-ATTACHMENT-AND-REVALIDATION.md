# Durable prepared attachment, corrupted-record repair and live-read dependency

Baseline: b912693b100e8b05b93c1906b170b461a20e7ea6 (Central SOURCE HOLD).
This is a candidate source checkpoint, not release permission.

## Protected storage and UI findings

Every existing record, regardless of status, now validates its exact envelope,
protocol, positive safe-integer revision, transaction, finite status, IV and
ciphertext bounds, then authenticates/decrypts/validates its payload before
replacement. Original wrapping-key ciphertext is also authenticated before
opening this helper. Unknown-to-draft metadata damage, ordinary draft corruption,
invalid revisions and replacement wrapping keys cannot lead to overwriting
recovery evidence. Clear-after-confirmation also validates the original record;
transaction commit compares revision, metadata, IV and ciphertext against the
validated snapshot. Maximum revision cannot overflow.

Save has a synchronous reservation and freezes its view/epoch/text/file/selection
until completion. All await boundaries recheck the snapshot. Inputs remain busy,
and lock disables both new buttons. A delayed callback cannot report that newer
visible edits were stored. Original ciphertext and original failure logs remain.

## Original encrypted descriptor cold recovery

The uploader supplies an immutable standard encrypted file descriptor to a
prepared-stage callback before message dispatch. That descriptor is encrypted
inside the original durable unknown intent. The controlled stage transition
may only add the first prepared descriptor while preserving all original core
fields; it cannot replace an already stored descriptor or renew the transaction.
Known-receipt cold restoration rechecks current audience and sends only after an
explicit click, using the original transaction, caption, file URI/key/hash/info.
It does not encrypt or upload again. Original readback and authorized index are
still required before clearing. Missing/unknown upload receipt continues to
block dispatch until actual settlement; this remains incomplete full-goal work.

## Approved shared dependency (no shared source write)

Central approved e77f3fb287aba657042965d853543261745e6cdf,
tree 1fe9f8cfa69ea911a75d564ba92b09a64a5f5891.
Its revalidation.go working bytes matched the approved blob
99409339d6a15f55c685f15f76b72bae78cb0da6 during read-only inspection.
The contract is PRODUCT-SESSION-BACKEND-REVALIDATION.md in packages/wallet-auth.

Social Config now accepts MatrixAudienceSessionRevalidator with the exact
Revalidate(context.Context, originalVerifiedSession, serverRouteScopes) method.
A's approved NewRevalidator(existingClient, keyID, Ed25519 private key) can be
assigned by the integration owner. No secret, key factory, signing domain,
shared copy/vendor or initial introspection-proof replay was added here.
Missing dependency yields 503 before nonce reservation or HS observation.

The route freezes the complete original verified session, repeats original
BrowserSSO binding/generation verification then performs the confidential read,
before the first observation and after each existing remote await. Session,
scope/tuple/device/binding or expiry changes are rejected; original current
policy/role/nonce/transaction/store guards remain. Shared 401/403/503 errors keep
their classification. A successful remote read is not a durable business commit
fence. No production registration/config/key was available or fabricated; the
production helper remains web-only. Synthetic readers exist only in Go test
fixtures (including existing native-shaped route tests), not a runtime fallback
or Native acceptance claim.

## Local executed evidence

- Original expanded protected-storage probe: six cases PASS with original
  ciphertext retained, including unknown status corruption.
- Original normal-DOM late Save probe: PASS, editableDuringSave=false,
  saved/current snapshot equal, Save/Restore disabled after lock. Only its module
  loader bundle path was changed; storage delay remains a synthetic callback.
- npm: 111 passed, no skips/failures; typecheck passed. New actual UI-handler
  test restores a prepared attachment in a fresh composer under the same
  transaction and fails if any new upload is attempted.
- Actual Chromium/WebCrypto/IndexedDB: original keys/device reused, separate
  page reload recovered original prepared descriptor/transaction/file; replacing
  that descriptor was rejected. This is a secure synthetic origin, not public
  HS or production user data.
- Full go test -race -v ./internal/social ./cmd/ynx-sociald: passed. New missing
  reader, after-await 401/403/503, relink/scope/TTL mutation guards passed; original
  independent audience and schema/store regressions remain in the run.
- Normal session-ui bundle succeeded (3.0 MiB); original five Chromium late
  review cases reran with the new module, exit 0.

Logs: durable-prepared/20261002/. Root's b912 old FAIL evidence is preserved.
Real backend-reader/key wiring, HS result settlement/idempotency, family/Native
lifecycle, actual browser/installed users, public and full Social v2/dot gates
remain unproved. No deployment, production state, real account authorization,
wallet signature/transaction, shared/Host mutation occurred.
