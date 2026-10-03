# Quant displayed Sharpe ratio versus stored integer formula

Predecessor `98a6440c5e84246e45dcb859ae85791d722abbb7`; ordinary Quant research UI only. No simulation, persisted schema, market, schedule, authority or execution implementation changed.

## Correction

The existing backend stores `SharpeMilli`, and the existing UI displays `SharpeMilli / 1000` to three decimal places. The experiment table had reused the integer-formula label “Sharpe × 1,000”, which incorrectly described the normalized displayed value. Latest-result and experiment headings now use a separate localized ratio label across all 12 supported languages. Run details keep the original stored-integer formula and its explicit multiplier, period/risk-free-rate assumptions. This does not relabel a non-annualized metric as annualized.

## Verification scope

Actual local Chrome uses the shipped page/app/catalog and actual local Go page. Controlled `SharpeMilli=1500` response must show `1.500` both in latest result and in retained temporary public research history, with “Sharpe ratio” headings. Formula details must still explain the integer multiplier. Language switching checks actual labels without destroying six draft fields or submitting.

An initial test attempt incorrectly asserted a persisted experiment table row after a controlled saved-mode POST that never actually persisted into the local service. It timed out: 69 passed / 1 failed / 0 skipped, 58354.29025 ms. The persistence boundary was not weakened to satisfy the test. The table assertion was moved to the existing explicit stateless/temporary receipt flow, where that returned result is actually retained on the page; saved receipt recovery still requires real service readback. Failure facts are retained here.

Final `node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/browser.test.mjs`: 70/70 PASS, 0 skipped, 45836.400916 ms. Node syntax and `git diff --check` PASS. No controlled test result is promoted as public research performance, approved Wallet access, saved service data or production completion.

## Publication

Source-bound public adoption requires the sole release owner to regenerate the coherent graph/pins and include this HTML/catalog with the cumulative owner fixes on this branch. Do not deploy independently or change shared protocol/Host files. Rollback uses the release owner's prior exact served graph, not a blind reset of this worktree. Public adoption, installed, provider approval/sign/transaction/private session and full completion remain false.
