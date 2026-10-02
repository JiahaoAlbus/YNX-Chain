# Social reader and protected-draft successor

Status: source regression only; no deployment or public/installed acceptance.
Parent: c71e0a51bb768e60c0d45454b9f7d4e4a013be2d.

After every confidential reader return, the original BrowserSSO binding and
generation are rechecked before continuing the original audience operation.
Both unchanged independent probes now pass under Go race, including revocation
inside the final reader before durable audience commit. Original failure logs
are retained alongside the successor results in `reader-revision/20261002`.

New draft writes use `ynx-social-protected-moment/v2`, with revision included in
AES-GCM AAD. The database, original v1 slot and original non-extractable wrapping
key remain unchanged. Opening/loading does not write or migrate legacy data.
Explicit successful save authenticates the old record first, then atomically
replaces it with v2 under the original CAS checks. Invalid existing data blocks
replacement and remains recoverable; delivery-unknown safeguards remain.

Legacy v1 remains readable with its original AAD and strict envelope checks.
Its numeric revision was never authenticated: CAS is not authentication. This
compatibility boundary cannot detect a valid numeric revision edit on a legacy
record. V2 rejects such edits and protocol downgrade. Neither format prevents
replay of a complete previously valid encrypted record or whole-store rollback.

Real isolated Chromium/WebCrypto/IndexedDB results: legacy read/preservation,
explicit migration, v2 numeric-revision tamper and downgrade rejection, and
cipher retention pass. Original six storage regressions pass without skips.
Consumers 111/111, typecheck, Social and daemon Go race passed in the owner
workspace. That workspace also contains separate uncommitted audience-feed
work; those aggregate runs are not an isolated committed-tree acceptance.
The two reader probes and revision/storage browser probes directly exercise
the files included in this minimal successor.

Central independent committed-tree review remains required. Unknown-upload
settlement, actual HS/RP/existing-MXID provenance and runtime acceptance remain
unproven. Deployment configuration is owned separately by writer2 A.
