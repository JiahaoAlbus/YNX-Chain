# Explicit review after draft changes

Base `54888419e99f2bbf8330501b4fbdbe8757e901dc`. Owner Exchange UI only;
no shared SDK/Host, account approval, order submission or capital operation.

Actual Chrome regression reproduced the original bug: start asynchronous public
rule refresh, edit price, revert to the exact original value, finish the read;
the old dialog reopened. Original run 1 FAIL, 2149.143667ms, true versus false
at the price draft-retirement assertion. Equality alone did not preserve the
user's review intent.

Input events, side changes and workspace navigation now advance a local draft
revision and retire old displayed costs. Both success/error continuations bind
that revision as well as exact values, account and permission revision. The
draft itself is not cleared and a fresh explicit Review still works. No new
authority, HTTP write, signature or protocol implementation is introduced.
App.js SHA256 f66bd452838837721a4098522e1a958edc3d226bccd04d563a5d33b813d21648;
the original HTML content pin was updated to these exact bytes.

Targeted actual preview/candle/lifecycle/arithmetic suite: 17/17 PASS, 12.283s.
Go entire Exchange product 11.718s and server 0.432s PASS. Exact current runtime
asset/intro tests 9/9 PASS: all 18 inventory names, both dependency graphs and
per-asset tamper negatives. Old test's 14-file constant and app-only verification
of introduction-only files were corrected without removing hash verification.

Existing live local Go browser terminal fixture is updated to explicit `/app`:
root is now the introduction, not the trading terminal. No-provider test binds
the exact before/after URL and one tab, not an invented `#market` normalization,
and is correctly labeled no-provider rather than installed-Wallet proof.
The isolated 12-language UI fixture PASS 4/4, 18.287s. Its output now goes to a
unique temporary evidence directory so reruns cannot overwrite old committed
captures. Latest: /var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-ui-product-oOBUaq.
The earlier parallel run's generated captures were preserved separately at
/tmp/ynx-exchange-ui-rerun-2rtOmo, and only those known run-owned overwrites were
restored to the original committed evidence. No user changes were discarded.

## Broader regression is not promoted

The all-files parallel suite returned FAIL. It identified old browser tests
visiting the newly introductory root, the obsolete 14-file inventory, historical
market handoff byte comparisons against an older UI, legacy release checker
identity-helper pin, two private account controlled-fixture admission failures,
and hosted-Wallet timeout. Its UI child retained an idle local listener after
more than four minutes; only that exact owned test child PID was terminated,
then the parent emitted failures. No other process or public service was stopped.
The separate bounded UI run passed. Original failure remains history, not a
full-suite PASS. Historical handoff/release and controlled private admission
fixtures still need explicit reconciliation; actual shared/installed/private
permission flows are not inferred from these local tests.

Syntax and diff gates PASS. Public/installed/provider approval/private account/
real orders/chain transaction/user acceptance remain NOT VERIFIED. Matching
artifact publication is handed to unique A, retaining original Host UNKNOWN
and rollback/data boundaries; do not blindly retry its earlier transport.
