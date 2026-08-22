# Finance candidate-environment preparation lease request

This is a Finance-only preparation request, not a production deployment authorization.

## Reviewed source

- reviewed checkpoint: `7dd818da9a227fb5b1c68fd5dda20eaf5d61b418` / tree `055120e0ef6855b87d020f684451df91f8c94b20`; this successor request is separate and non-self-referential;
- runtime candidate: `7824af677dd052d20321431381523ab302614d98`;
- archive: SHA-256 `d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`, 3,937,491 bytes;
- generator: `finance-candidate-env-generator.sh`, 1,698 bytes, SHA-256 `cf7b804be50e8f75765f52b67e39e62a67e211add8bb17edcadf2b4e25940c07`;
- generator: 1,698 bytes, SHA-256 `cf7b804be50e8f75765f52b67e39e62a67e211add8bb17edcadf2b4e25940c07`;
- placement bootstrap: `finance-candidate-env-placement-bootstrap.sh`, 3,263 bytes, SHA-256 `2a8c03644fa2ec88aafcbaf12e354de8b5a8f244caf3e230132e21ac5dbc2701`;
- preparation executor: 2,835 bytes, SHA-256 `a2b9bdfbaa175955c5ae4c82015c88d806fd9e7374742e5fc2e26f0e97afb5f0`.

## Requested single-use scope

Initially absent `/opt/ynx/stage/finance` and `/opt/ynx/leases/finance-preparation` must be created in order with mode `0750`; then exactly one `/opt/ynx/stage/finance/<lease-id>` carrier (`0700`) and its tools directory are created. Transfer the frozen lease, generator, preparation executor and archive from their signed source blobs with restrictive permissions before execution, then verify every transferred object’s bytes/SHA/owner/mode/nlink and the created parents/carrier device+inode tuple. The bootstrap runs the preparation executor once; it produces the candidate env without printing env contents.

The lease must freshly bind current env path, bytes, SHA-256 and an exactly-one `YNX_FINANCE_WEB_DIR` precondition; the immutable target release `/web` path; archive input path/bytes/SHA; the generator path/bytes/SHA; and the signed parent tuple. The generator must output metadata only, never env content.

No Caddy, service, `finance-current`, release, state, public-route, account, signing or transaction mutation is allowed. On partial transfer/execution failure, cleanup deletes only captured inode/hash-matching files and reverse-order empty run directories; substituted, sibling or symlink objects must be refused and preserved. Terminal success retains the carrier and prints secret-safe receipts. A separate rollback-first production lease is still required.
