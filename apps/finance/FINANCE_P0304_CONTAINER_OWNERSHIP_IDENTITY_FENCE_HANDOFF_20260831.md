# Finance P0-304 container ownership identity fence handoff

This is a source-and-test-only successor. It does not authorize SSH, production reads or writes, cleanup, deployment, restart, link switching, environment changes, Caddy changes, or public verification.

Central P0-303 directly proved that all P0-302 stage, backup, and release leaves and containers are absent, the old `3b2383f5` runtime remains healthy, `mutationCount=0`, and `cleanupNeeded=false`. P0-302 and P0-303 are nonreusable.

The production `RELEASE_MATERIALIZE` failure came from comparing a preownership tuple that included uid and gid with the post-`chown` tuple. The legitimate root-owned to root:`ynx` group transition changed gid and was therefore rejected. The former local fixture used a no-op gid and masked that production-only path.

Implementation `448851ba7d33399385b89eb3356bc9ce4f345721` binds each freshly created stage, backup, and release container across ownership changes by device, inode, nlink, and directory type only. After that immutable identity matches, it separately requires the exact signed uid, gid, and mode and captures the settled cleanup identity. A replacement at the ownership boundary changes inode and fails closed; cleanup will not delete the unbound replacement.

The production actual-shell fixture now performs a real non-noop group transition to a supplementary gid and adds stage, backup, and release container substitution negatives. Existing foreign, non-empty, symlink, cleanup, automatic rollback, manual rollback, and post-move substitution gates remain intact.

Validation passed: Bash syntax, static command-object checks, the complete production actual-shell fixture, `git diff --check`, Finance/read-integration/admin/server Go tests, and the Finance race suite.

The only executable blocker is a wholly new Central Finance-only single-use lease. It must freshly bind the old production runtime, immutable carrier, retained parents, fresh six-path absence namespace, real service gid and exact P0-304 objects. No production action is permitted before that independent review and lease.
