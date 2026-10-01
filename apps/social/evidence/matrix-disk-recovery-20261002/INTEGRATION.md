# Disk checkpoint and independent process recovery

Parent freeze e55cce09c12d289511f244edc4ea18b1d89bf125. No transport, cryptographic library, identity, UI or shared backend source changes in this segment.

## QA observation correction

The earlier failed federation-persistence-failure.json remains immutable in its existing commit/path. SDK backend.getSavedSync reads its live in-memory accumulator; that earlier two-snapshot comparison cannot establish disk preservation. It was not changed to PASS.

The corrected QA pauses only the isolated SDK sync loop before baseline, completes its save, and uses a separate native indexedDB.open connection and readonly sync-store getAll transaction for the persisted baseline. Injected failure replaces only this disposable client's backend.syncToDatabase. Real SDK store.save triggers the actual degradation path and Social lock handler. A second independent native readonly transaction reads persisted records after failure. Exact serialized persisted records must match, have a nonempty nextBatch, contain encrypted events and not contain the known offline text or attachment plaintext. Cache clearing remains prohibited. Original wrapped crypto key record is read without replacement; temporary unwrapped key bytes are zeroed.

The QA closes the entire persistent browser context/process, opens a new persistent context at the same isolated origin/profile, and reconnects using the original account/device and protected crypto store. It reads the offline encrypted attachment descriptor and decrypts/downloads the original media. No recreation of account, original device, crypto keys or cache. This is controlled process-close/restart, not an abrupt SIGKILL/power-loss simulation.

## Executed result

federation-disk-recovery.json: LOCAL_BROWSER_FEDERATION_PARTIAL_PASS, 13 actual checks PASS. Native disk checkpoint/ciphertext preservation, lock, device preservation and independent browser-process recovery all PASS. Checkpoint SHA256 is recorded without dumping raw persisted content or keys. Original double-homeserver text/ciphertext, attachment, offline recovery and both explicit rejection checks also PASS. console-pageerror-zero is only Playwright pageerror monitoring, not full browser console/network error acceptance.

The injected backend persistence failure exercises real browser IndexedDB readback and SDK degradation. It is not a physical disk failure, native quota exhaustion, crypto DB corruption or simultaneous multi-tab writer test. Those remain NOT_RUN. No product/user database or public system was touched.

## Existing gates retained

Product SSO consumer fix and 16 policy tests from parent remain the source candidate; this segment did not rerun unrelated suites. Confirmed device deletion was previously executed and FAILED at 401 with no advertised identity stages. Production OIDC authentication, token invalidation, new-key exclusion, post-revoke recovery, Native, backup, public ordinary product journey and production bridge integration remain NOT_RUN. Shared YNX authority/HS OIDC operator configuration and deployment are exclusively A-owned. A still needs a real supported SSO issuer and exact-session fallback adapter; no administrator or AS-token bypass.

The prior INTEGRATION sentence now distinguishes executed FAILED deletion from subsequent NOT_RUN checks. Historical SHA inventory under matrix-sso-fallback-20261002 remains bound to original e55cce09 freeze; this segment's SHA256SUMS is the current inventory including the amended document. All old failed receipts, v2 data, SDK cache, profiles and keys are retained. Own temporary servers/network stopped. No deployment/user approval/sign/chain transaction.
