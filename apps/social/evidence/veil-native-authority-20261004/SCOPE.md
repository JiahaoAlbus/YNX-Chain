# Native authority/storage follow-up, still dormant

Base: a520242293f38f036d61fce75be2655e790154b3.
This supersedes the authorize(String)-to-Unit draft within Social-owned source.
It does not change shared authority, Matrix senders, enrolled keys or releases.

Native leases bind owner, device, Social identity fingerprint, wrapping key alias,
verified revocation generation and monotonic expiry. Lease membership is private
to its issuer. Scope/thread lifetime, foreign handles, expired leases, generation
rollback and clock rollback reject. A single exclusion orders revoke completion
against the complete synchronous native commit; reentrant authority mutations
are rejected. No asynchronous work or unguarded later key effect is admitted.

The trusted verifier is a REQUIRED native provider, not supplied here. It must
verify actual protocol evidence and current revocation status. The host fixture
is expressly synthetic, not device approval or cryptographic verification.
SSO and funds keys are not approval methods; no JS metadata grant exists.

Reads query length/type metadata separately before selecting BLOB content.
Aggregate bounds precede ciphertext-state hashing: 4096 rows, 64 MiB total,
8 MiB plus wrapping overhead per record, bounded IDs/kinds and BLOB type only.
Direct length(sealed) is used instead of CAST; isolated SQLite EXPLAIN confirms
its length-only column opcode. Android's own CursorWindow/opcode is unverified.

Checkpoint comparison binds revision plus the entire canonical ciphertext-state
digest and the complete device tuple. An authenticated durable monotonic anchor
outside SQLite is REQUIRED; no implementation or automatic enrollment/reset is
supplied here. Keystore is NOT assumed to be a monotonic counter. The anchor
advances before DB commit, so a failed commit/crash produces a recovery hold, not
silent acceptance of an older DB. Trusted recovery/roll-forward availability is
NOT implemented or verified. These gates deliberately prevent activation.

Component compile and host contract tests are not Android/runtime safety proof.
Still unverified: production native proof verifier and anchor; cross-process
revocation; platform checkpoint/recovery and Keystore tests; official JNI store
callbacks; fresh SPQR contribution; protocol vectors; two real nodes/migration;
independent review, AGPL disposition, activation, all Social product journeys
and actual dot/MONSTER acceptance. Existing Matrix and legacy history stay intact.
