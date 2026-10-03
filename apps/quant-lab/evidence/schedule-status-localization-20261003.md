# Source-reported research schedule status

Parent source checkpoint: 774150aa23f0cb09c3312133df203a31c56a7b0a.
Owned delta: Quant ordinary app display and directly matching business tests.
No scheduler execution, permissions, SDK, deployment or formal pin change.

Previously saved schedule rows rendered raw backend lastRunStatus codes. Known
service statuses now map to distinct user-facing text in all 12 existing locales:
en, zh-CN, zh-TW, ja, ko, es, fr, de, pt, ru, ar, id. Claimed/running says completion
is not verified; scheduled does not mean completed. Failure messages explain
configuration review or market-data retry at the next saved due time. Unknown
future/inherited/prototype status keys fail closed as unverified and disable the
schedule mutation button. Locale changes rerender observed status; no account,
new result, order or auto-retry is manufactured.

Executed matching served-source VM business tests: 57/57 PASS including every
known status in every locale and unknown/prototype/HTML-injection states, no PUT
on those unknown states. This is controlled UI-state evidence, not a real public
scheduled run or provider grant.

Combined business and actual Go/local Chrome saved-research restart regression:
58/58 PASS, 4490.036166ms total. Actual browser case 4254.54875ms; both real local
process launches stopped normally after SIGTERM, no duplicate saved experiment.
Retained controlled QA root:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-Rfe85t`.
Local binary 11466914B SHA256
`de7d339c3cdbc349e194c3ef0b12c6bfc9e87959072ff0cdc1bccc6328df2363`.
JS syntax and git diff --check PASS.

Formal coherent graph and publication remain the unique release owner's scope.
Public source binding/real Wallet/provider approval/Product Session/installed
release/actual trading remain unproven by these tests. Existing published runtime
cannot inherit this source delta without exact release integration. Ordinary
rollback is this isolated app/test delta, not an old shared-authority deployment.
