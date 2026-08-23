# Finance Phase3 stdin deployment lease successor

Central rejected the first Phase3 request only because the sudo/stdin transport was not frozen. This successor supplies that missing command object and its direct fixture.

The bootstrap accepts raw bytes for one exact Central-signed, non-secret production lease on stdin. It verifies the already prepared P0-236 archive and environment, refuses foreign carrier content or a pre-existing deployment lease directory, atomically places the exact reviewed production executor and signed lease, and invokes deploy once. It never retries.

Before deploy begins, any partial placement is removed only when the exact created file identity still matches. Once deploy begins, the exact executor/lease pair is deliberately retained on success or failure. The production executor owns its first-failure rollback trap, while the retained pair freezes the only possible separately authorized manual recovery command: the same executor with `rollback` and the same lease. The fixture proves the success, malformed-input cleanup, foreign-content refusal, symlink preservation, retained failure pair, and manual rollback path.

This remains a request only. Central must independently fill the two Git blobs, rerun all fixtures, fresh-read production state, construct the exact signed lease, and freeze every literal command/argument before issuing a wholly new single-use lease. No production SSH, deployment, account request, signing or transaction occurred.
