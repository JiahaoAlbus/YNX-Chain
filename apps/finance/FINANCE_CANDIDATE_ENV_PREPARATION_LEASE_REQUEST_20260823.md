# Finance Phase 1 placement-bootstrap lease request

This is a Finance-only Phase 1 receipt request. It does not transfer objects or authorize production.

## Reviewed source

- reviewed checkpoint: `fb0aa3b91f02a31733f9554ce4f5319c8fc1a393` / tree `3a18e8e418a5b10fb55559eac9b9ff1bb650d790`; this successor request is separate and non-self-referential;
- runtime candidate retained for a later Phase 2: `7824af677dd052d20321431381523ab302614d98`;
- signed pre-existing root: `/opt/ynx`, tuple `64770:1312502:0:0:755:47:4096:directory` (must be freshly re-read by the lease executor);
- placement bootstrap: `finance-candidate-env-placement-bootstrap.sh`, 3,101 bytes, SHA-256 `afe97c3abec3ba01e0a9b3d0feee46096a603427dc80c8f7da59a24368108a96`;
- hermetic actual-shell fixture: `test-finance-production-fixture.mjs`, 21,499 bytes, SHA-256 `11940f402a1a77fb62bfc70d4dd29699c05ae1b694baa3a469932e42eb8d2a43`.

## Requested single-use scope

`/opt/ynx` must be an existing non-symlink directory matching the signed tuple. Its initially absent intermediate children `/opt/ynx/stage` and `/opt/ynx/leases`, then leaf roots `/opt/ynx/stage/finance` and `/opt/ynx/leases/finance-preparation`, are created one exact level at a time with mode `0750`; one empty `/opt/ynx/stage/finance/<run-id>` carrier follows with `0700`. Phase 1 captures and emits observed device/inode/uid/gid/mode/nlink/bytes/type tuples and signed absence/emptiness receipts only. It must not transfer a lease, generator, preparation executor or archive, and must not generate candidate env.

The Phase 1 lease binds only the unique run ID, signed existing-root tuple, initially absent paths and expected modes. Intermediate and leaf tuple values are dynamic observations, never pre-signed. On failure, only captured, empty, inode-bound children are removed in exact reverse creation order; intermediate parents are retained if a sibling, substitution or nonempty condition prevents safe deletion. Phase 2 may be requested only after Central accepts and releases this receipt; it can then bind the observed parent and carrier tuples along with later archive/generator/env inputs.

No Caddy, service, `finance-current`, release, state, public-route, account, signing or transaction mutation is allowed. The actual-shell fixture executes the real bootstrap from a pre-existing `/opt/ynx` equivalent with both intermediate parents absent. It covers successful receipt, partial mkdir failure at each created level, pre-existing and post-create symlink refusal, unowned sibling preservation, and full final absence after safe cleanup. Central must accept/release the Phase 1 observed receipt before a separate Phase 2 preparation request can bind those tuples.
