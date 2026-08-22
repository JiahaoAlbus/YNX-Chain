# Finance Phase 1 placement-bootstrap lease request

This is a Finance-only Phase 1 receipt request. It does not transfer objects or authorize production.

## Reviewed source

- reviewed checkpoint: `fb0aa3b91f02a31733f9554ce4f5319c8fc1a393` / tree `3a18e8e418a5b10fb55559eac9b9ff1bb650d790`; this successor request is separate and non-self-referential;
- runtime candidate: `7824af677dd052d20321431381523ab302614d98`;
- archive: SHA-256 `d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`, 3,937,491 bytes;
- generator: `finance-candidate-env-generator.sh`, 1,698 bytes, SHA-256 `cf7b804be50e8f75765f52b67e39e62a67e211add8bb17edcadf2b4e25940c07`;
- generator: 1,698 bytes, SHA-256 `cf7b804be50e8f75765f52b67e39e62a67e211add8bb17edcadf2b4e25940c07`;
- placement bootstrap: `finance-candidate-env-placement-bootstrap.sh`, 3,263 bytes, SHA-256 `2a8c03644fa2ec88aafcbaf12e354de8b5a8f244caf3e230132e21ac5dbc2701`;
- preparation executor: 2,835 bytes, SHA-256 `a2b9bdfbaa175955c5ae4c82015c88d806fd9e7374742e5fc2e26f0e97afb5f0`.

## Requested single-use scope

Initially absent `/opt/ynx/stage/finance` and `/opt/ynx/leases/finance-preparation` are created in order with mode `0750`, followed by one empty `/opt/ynx/stage/finance/<run-id>` carrier (`0700`). Phase 1 captures and emits observed device/inode/uid/gid/mode/nlink tuples and empty/absent receipts only. It must not transfer lease/generator/preparation/archive objects or generate candidate env.

The lease must freshly bind current env path, bytes, SHA-256 and an exactly-one `YNX_FINANCE_WEB_DIR` precondition; the immutable target release `/web` path; archive input path/bytes/SHA; the generator path/bytes/SHA; and the signed parent tuple. The generator must output metadata only, never env content.

No Caddy, service, `finance-current`, release, state, public-route, account, signing or transaction mutation is allowed. On mkdir failure, cleanup removes only captured tuple-matching empty carrier/parents in reverse order; substituted, sibling or symlink paths are refused and preserved. Central must accept/release the Phase 1 observed receipt before a separate Phase 2 preparation request can bind those tuples.
