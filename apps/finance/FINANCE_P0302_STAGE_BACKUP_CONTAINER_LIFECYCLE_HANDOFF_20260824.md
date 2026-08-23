# Finance P0-302 stage and backup container lifecycle handoff

This is a source-only successor. It does not authorize SSH, deployment, restart, link switching, environment changes, Caddy changes, public verification, account access, signing, or transactions.

P0-301 directly proved that every P0-300 mutable deployment path is absent, the old service remains exact and healthy, and the mutation count is zero. P0-300 is nonreusable.

The production failure was caused by a missing intermediate-directory contract. The stage and backup leaf paths were signed below `$parent/$LEASE_ID`, but the executor attempted to create the leaves without first creating those lease-owned containers. The old local fixture recursively created the intermediate directories and therefore did not reproduce production.

Implementation `170145e461146b53937d2b8e665008c2a9451db5` makes `stageContainer` and `backupContainer` first-class signed objects. Each is absent before writes, created without parent recursion, checked as a regular non-symlink directory before ownership changes, rebound to its original device/inode after ownership changes, and removed only after its exact child is safely removed and the container is exact and empty.

A successful deploy removes the stage leaf and stage container but retains the exact backup leaf and backup container for rollback. Its receipt now emits backup-container and backup full tuples, identity tuples, and inventory hashes. A separately signed manual rollback must consume those receipt fields, prove stage remains absent, restore the old runtime, then identity-clean the backup leaf and empty container. Foreign, non-empty, symlinked, or substituted objects are preserved and force a fail-closed result.

Local validation passed: Bash syntax, static command-object checks, the production actual-shell fixture, the phase-3 stdin bootstrap fixture, and diff checks. The actual-shell fixture now begins with both lease containers absent and covers positive creation, success retention, automatic rollback cleanup, manual rollback cleanup, missing retained parents, foreign objects, symlinks, post-create substitution, non-empty containers, and leaf-creation cleanup.

The only executable blocker is a wholly new Central Finance-only single-use lease. Central must independently review the exact objects, freshly bind all current production and immutable carrier facts, freeze a new six-path namespace plus signed container owner/mode values, and sign new stdin and literal launcher argv. No production action is permitted before that lease.
