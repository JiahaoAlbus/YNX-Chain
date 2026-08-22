# Finance Phase 1 placement-bootstrap lease request

This is a Finance-only Phase 1 receipt request. It does not transfer objects or authorize production.

## Reviewed source

- reviewed checkpoint: `fb0aa3b91f02a31733f9554ce4f5319c8fc1a393` / tree `3a18e8e418a5b10fb55559eac9b9ff1bb650d790`; this successor request is separate and non-self-referential;
- runtime candidate retained for a later Phase 2: `7824af677dd052d20321431381523ab302614d98`;
- placement bootstrap: `finance-candidate-env-placement-bootstrap.sh`, 1,753 bytes, SHA-256 `4a27f9eaed67ea17ab1476c516ba7fbda8cc95c99d03e23af37f04592823b4e4`;
- hermetic actual-shell fixture: `test-finance-production-fixture.mjs`, 21,028 bytes, SHA-256 `4cd9f8286f56db7731f45661857ce8c9159dd1b1bc0b2d838bbeda6af7c4c480`.

## Requested single-use scope

Initially absent `/opt/ynx/stage/finance` and `/opt/ynx/leases/finance-preparation` are created in order with mode `0750`, followed by one empty `/opt/ynx/stage/finance/<run-id>` carrier (`0700`). Phase 1 captures and emits observed device/inode/uid/gid/mode/nlink/bytes/type tuples and signed absence/emptiness receipts only. It must not transfer a lease, generator, preparation executor or archive, and must not generate candidate env.

The Phase 1 lease binds only the unique run ID, initially absent paths and expected modes. The tuple values are dynamic observations, never pre-signed. Phase 2 may be requested only after Central accepts and releases this receipt; it can then bind the observed parent and carrier tuples along with later archive/generator/env inputs.

No Caddy, service, `finance-current`, release, state, public-route, account, signing or transaction mutation is allowed. On mkdir failure, cleanup removes only captured tuple-matching empty carrier/parents in reverse order; substituted, sibling or symlink paths are refused and preserved. The actual-shell fixture executes the real bootstrap from absent roots and covers successful receipt, partial mkdir cleanup, pre-existing and post-create symlink refusal, and unowned sibling preservation. Central must accept/release the Phase 1 observed receipt before a separate Phase 2 preparation request can bind those tuples.
