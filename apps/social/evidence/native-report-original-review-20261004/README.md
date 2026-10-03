# Explicit original report recovery review

Parent: 0cfc63381efbd0e995a1a39bda13b1a8d6b4543b.

The existing native Report entry now first reads the original account/target
report intent through the current-view guard. A pending original is presented
as Retry the original report, explaining its original category and evidence
fingerprint count and that newer moment content will not replace the request.
Cancel performs no send. Retry original requires a fresh explicit click, checks
the captured original authority again, and passes the retained draft through
the existing durable intent controller. No new key or evidence is substituted.
The existing normal Report confirmation remains for new/completed operations.

The readonly review method returns an immutable copied draft, completion state
and original record ID, never a grant or private key. It does not send or write
storage. Four regression tests cover cold original review without side effects,
different account/target, already stale zero storage reads, and authority loss
during storage read without exposing the draft. Full project typecheck, complete
frontend suite and actual Android/iOS bundle results are adjacent logs/status.

This source integration improves the actual original UI path; it is not a
device demonstration. Installed confirmation behavior, original real backend
readback, local account-data-deletion cleanup, callback/platform provenance,
public source identity, MONSTER acceptance and full crypto gates remain open.
No real report, account request, signing, transaction, deployment or device
activation occurred. Existing records, first failures and previous freeze
artifacts remain preserved.
