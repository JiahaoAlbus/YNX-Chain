# Finance candidate-environment preparation lease request

This is a Finance-only preparation request, not a production deployment authorization.

## Reviewed source

- reviewed checkpoint: `8122e6614c1ffd281338a8b833ea745cecee21a5` / tree `f882c00a136bd7230d8a704b43b7ed94688278fd`;
- runtime candidate: `7824af677dd052d20321431381523ab302614d98`;
- archive: SHA-256 `d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`, 3,937,491 bytes;
- generator: `finance-candidate-env-generator.sh`, 1,698 bytes, SHA-256 `cf7b804be50e8f75765f52b67e39e62a67e211add8bb17edcadf2b4e25940c07`;
- preparation executor: `finance-candidate-env-preparation.sh`, 2,900 bytes, SHA-256 `6c758b2861cff04ba06da5a0913133c7f28d9c14410360730964be0c0c7c250e`.

## Requested single-use scope

Central may authorize exactly one unique protected carrier under `/opt/ynx/stage/finance/<lease-id>`, archive input verification/copy, and exactly one generator invocation against the freshly-read `/etc/ynx/finance.env`. The resulting carrier must retain the archive and candidate `finance.env` with exact path, bytes, SHA-256, owner/mode/nlink and carrier parent device/inode/owner/mode/nlink receipts.

The lease must freshly bind current env path, bytes, SHA-256 and an exactly-one `YNX_FINANCE_WEB_DIR` precondition; the immutable target release `/web` path; archive input path/bytes/SHA; the generator path/bytes/SHA; and the signed parent tuple. The generator must output metadata only, never env content.

The preparation executor may not invoke systemctl, modify Caddy, switch `finance-current`, mutate release/state/public routes, request accounts, sign or transact. On any failure it removes only its exact newly-created carrier and verifies absence; on success it retains the carrier and prints secret-safe terminal receipts. A separate rollback-first production deployment lease is required after Central independently accepts and releases this preparation evidence.
