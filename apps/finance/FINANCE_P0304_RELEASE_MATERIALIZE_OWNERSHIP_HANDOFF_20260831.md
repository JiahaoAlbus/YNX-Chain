# Finance P0-304 RELEASE_MATERIALIZE ownership correction

Status: source-only. No SSH, deployment, cleanup, rollback, service action, Wallet action, signing, or transaction was performed.

P0-303 directly established that P0-302 left no deployment residue and the old Finance runtime remains healthy. The failed path was narrowed to `RELEASE_MATERIALIZE`.

The correction preserves the release-container physical identity across its authorized ownership transition by comparing only device and inode before versus after `chown`. It separately requires exact signed uid, gid, and mode after `chown`. This avoids rejecting the valid `root:root` to `root:ynx` group transition while retaining symlink, substitution, nonempty-directory and foreign-object refusal.

The production actual-shell fixture now executes an actual supplementary-group transition and proves the candidate switch can occur only after the physical identity and signed ownership checks. Automatic rollback and post-cleanup phase/failure/rc receipts are unchanged.

The remaining source-only blocker is the absent immutable Linux archive needed by the GNU-tar metadata fixture. Its exact path and SHA-256 are recorded in the request; no replacement archive was created.
