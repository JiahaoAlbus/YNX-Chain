# Paper kill new-intent boundary

Parent checkpoint: dc2d5623cc3de85e3df4f73fdb5d8d40c79e3ba7.
Ordinary Quant app/tests only; server kill/idempotency rules unchanged.

Before fix, two new direct tests FAILED: selecting a saved strategy enabled the
submit button under KillSwitch=true; kill arriving during confirmation still
sent one new Paper POST. Server already refuses new execution, but the UI did
not honor the known stop. Now a shared submit-control predicate blocks fresh
intents during render, selection, completion and both sides of confirmation.
Programmatic submit is also blocked before creating a request/key. Existing
localized kill status explains why in all 12 languages.

Existing uncertain intents are deliberately retained and may use only their
same exact-key recovery, matching the server's existing committed-receipt replay
before kill enforcement. A key not committed cannot execute while killed.
Recovery completion disables fresh submission again; no automatic retry, new
key or unconfirmed order success is invented. Research/read paths remain usable.

Direct business suite: 62/62 PASS, 354.982208ms, including all-language stop,
confirmation-time change and exact pending-key recovery/preservation.
Actual local Go/Chrome risk subset: final 3/3 PASS, 3780.206792ms. The actual
service kill receipt survives lost GET/late old snapshot and reload. A declared
saved-strategy UI fixture (not engine-created research) tests selection and
programmatic submit under that actual kill: zero order HTTP requests, no intent.
Earlier browser attempt: 1 PASS/1 FAIL/1 timeout; new persistent hint caused an
old all-page text locator to be ambiguous, and hidden Paper selector was used.
Corrected toast-specific locator and real Paper navigation; failures retained.
Go race tests PASS (quantlab cached, server 1.569s); JS/diff checks PASS.

No public/installed/user Wallet/account/sign/transaction evidence. This is local
Paper QA, not real capital. Formal asset pins/Host remain release-owner scope;
integrate ordinary hunks, not the whole inherited checkout. No DB migration.
Rollback: this isolated app/test/evidence delta, preserving pending records.
