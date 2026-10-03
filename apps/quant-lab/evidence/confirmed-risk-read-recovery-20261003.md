# Confirmed Quant risk receipt survives read failure

Parent source: 2a791bcf67c98873ff9b74346293388dbfbfa15e.
Ordinary product scope only: app risk display plus direct tests. No shared
Wallet/Auth/authority/storage schema/Host/release pin change.

Reproduced product defect before fix: a valid kill/reconcile write receipt was
only used for a toast; the app depended on a subsequent snapshot to show it.
When that GET failed, snapshot.paper.KillSwitch remained false. A pending older
snapshot could also overwrite the newly confirmed risk state. New direct test
FAILED before the fix (`false !== true`, confirmed receipt retained assertion).

Fix: invalidate reads admitted before dispatch, validate the existing exact
risk receipt, advance read revision and display that service receipt immediately
before follow-up refresh. A failed GET does not discard a confirmed receipt;
retired reads cannot overwrite it. Both risk controls share one pending lane
to prevent cross-operation receipt order confusion; controls resume after the
bounded request settles. No write retry, new authority or fabricated success.
Invalid write receipts remain unconfirmed under the existing validator. A write
with unknown network outcome is not promoted to a confirmed risk result.

Tests:
- Direct business-flow: 59/59 PASS, 348.308625ms. New cases cover kill/reconcile
  follow-up failure + late old snapshot and both pending-operation directions.
- Actual isolated Go + Chrome risk subset: 3/3 PASS, 4550.182417ms. Actual kill
  response, aborted follow-up GET, delayed actual pre-write snapshot, displayed
  ACTIVE, normal reload persistence; no injected risk success.
- Full actual Chrome suite initially 21/22 PASS / 1 FAIL: legacy schedule test
  wrongly required raw English backend codes in Arabic after prior localization.
  Corrected assertions separately require canonical runtime state and translated
  status through stop/cancel/reload; raw backend codes must not leak into rows.
- Full Chrome rerun: 22/22 PASS, 0 skipped, 48458.946083ms.
- Earlier combined business + two-browser actual Go restart: 59/59 PASS,
  9023.95225ms, before the additional lane test. Two clean SIGTERM stops.
- `go test -race ./internal/quantlab ./apps/quant-lab/server`: PASS;
  internal/quantlab cached, server 1.434s.
- JS syntax and diff checks: PASS.

Browser suite screenshot directory is `tmp/quant-lab-evidence` in this owner
worktree (local QA, not public runtime/installed app). Go fixtures use temporary
local state; simulated Paper, not Testnet capital execution or real account
approval. Public/installed/Product Session/real trading gates remain unproved.
Unique release owner must review these ordinary hunks and current source-bound
asset identity; do not publish the inherited mixed checkout or waive old pins.
Rollback is this isolated product/test delta; no state migration is required.
