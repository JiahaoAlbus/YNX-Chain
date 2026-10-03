# Quant strategy lifecycle and table localization

Ordinary owner baseline `15c96ef7962c97f94486e715dbce1ca36ff83ecd`, branch `codex/exchange-sso-cookie-binding-20261002`. This inherits the prior recovery fix; it does not restart Quant or change Wallet, product authority, engine, storage, Host, release or another product.

## Implemented display correction

The Arabic local browser screenshot previously showed untranslated strategy lifecycle prose and table headers. The static lifecycle paragraph and six strategy headers now consume the existing catalog and applyLocale path, with explicit entries in all twelve current catalogs. Risk approval/evidence for every transition and Wallet approval before bounded Testnet remain stated. English default text is preserved.

Only explanatory prose and labels are translated. Source strategy family/stage values, user names, IDs, hashes, licenses, scheduling rules, receipts, research metrics and permissions are untouched. Canonical source enum strings can remain visible in rows; this fix is not a claim that every existing product page is fully translated or that any stage transition has executed.

## Verification

- Before fix: expanded real-Chrome locale coverage FAILED on missing `strategyLifecycle` catalog entry.
- `node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/ui.test.mjs`: 75/75 PASS, 413.78425 ms; all twelve catalogs cover every English key without blanks.
- Real local Chrome expanded language/draft checks and schedule recovery checks: 2/2 PASS, 5061.555583 ms. Twelve actual locale options, exact rendered catalog labels, preserved research name/cost draft, zero POST during language traversal, one tab, no viewport-wide horizontal overflow. Follow-up test also asserts the source snapshot JSON is byte-identical through every locale change.
- i18n/app-test syntax and `git diff --check`: PASS.

Actual local screenshots were inspected. Per-run unique paths now prevent future test runs from replacing previous screenshot evidence. Retained directory:

`tmp/quant-lab-evidence/schedule-recovery-Xl7lKu`

- `schedule-unconfirmed-en.png`: SHA256 `7b8dbf4789450d3c0d877ccbc47ea71168dc20bdbc69a489b980db76c9ca3ced`.
- `schedule-unconfirmed-ar.png`: SHA256 `04b49bd838ba6167527fcd928b7c39d3db28d7fc4cf66a327572f9140ba6eeaf`.

These screenshots show controlled local HTTP/schedule data on the actual page, not public authentication, production execution, installed packages or ComputerControl acceptance. Existing prior fixed-name QA screenshots are mutable test outputs; their previously recorded digests must not be used to identify this successor screenshot.

## Integration and rollback

Bring only the ordinary HTML data-i18n attributes, catalog additions and direct tests into A's current coherent release graph; never substitute this inherited index.html/checkout wholesale or rewrite historical pin manifests. Rollback is an ordinary successor revert of these display-only changes. No persisted data, secret, account authorization/signature/order or production change occurred. Source-bound public release, real account/business journey and installers remain separate incomplete gates and are routed to the current continuation audit.
