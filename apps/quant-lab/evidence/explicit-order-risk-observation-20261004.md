# Quant explicit order risk observations

Source commit `72e2171c6bfb0b795d0cffdf79b3b475b8d0827f`;
tree `77c93ebb01ec43840fe5327a140fb47eb7fe9135`;
branch `codex/exchange-sso-cookie-binding-20261002`.

## Defect and correction

The original Testnet order UI populated oracleAsOf using the browser clock
and hard-coded venueHealthy=true at submission, alongside example default
risk amounts. Those were not evidence of an observed oracle/venue state.

All risk amounts now start blank. Oracle time and venue health must be
explicitly entered; unknown/unhealthy venue states cannot submit. Integers
must use unambiguous decimal syntax and safe ranges; observation timestamps
must be valid timezone-bound calendar instants, not future or older than 30s.
The original timestamp is retained, never silently refreshed.

Order preview retains exact order draft, mandate digest and risk observations,
displaying the observations as operator-entered, not verified oracle data.
Submission requires explicit confirmation and exact comparison before and
after private proof acquisition. Changed risk/mandate/form/account or expired
observations cannot authorize a different request. Existing form input events
retire signing previews. Eight new copy keys exist in all twelve languages.
No signing/private authority protocol or service-side risk rule changed.

## Executed local verification

`node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/order-risk-preview-browser.test.mjs apps/quant-lab/tests/research-recovery-browser.test.mjs`

**113 pass, 0 fail, 0 skip**, 14023.435792 ms.

New tests cover absent/future/stale/impossible timestamp; unknown/unhealthy
venue; blank/exponent/fraction/negative/unsafe integer; preview exact original
time; changed risk/mandate; denied confirmation; changed risk while proof is
pending; twelve-language labels/rejections. Real Chromium uses exact /api/v1
wire paths and the original shipped app to prove blank initial observations,
visible local controlled preview, edit retirement, stale rejection and zero
Wallet proof calls. No account/signature/order execution is performed.

The first browser fixture used /v1 instead of the real /api/v1 prefix and
failed (the service restart case passed); corrected the fixture routes and
waited for actual preview visibility. Assertions were not relaxed.

Retained original Go/Chromium test: two independent browser contexts,
lost-response reconciliation, schedule/result isolation, reload and full cold
restart; four clean SIGTERM stops. Retained QA root:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-woRKgK`.
Local Go QA binary: 11516786 bytes, SHA256
`59c960666ac41a254e27eb6d6a9d1626ff19450f181627a7ca4f737236dade9a`.
This unchanged Go binary reads owned Web source; it is not a formal new release.
Node syntax and Quant-only diff checks passed.

## Source identities and boundaries

- app.js blob `95b648be50c1f3162b0195d86aa99f614e3c5cb1`, SHA256 `ffb6dd623d5b2396b7ac60eadc5ff8b4f8f8229bb613e19835e32513b26f941b`.
- index.html blob `6bc8b4cd59a3d9472c223e7a749a3783bc7d547a`, SHA256 `447afb192ec346cca3db930dd6eaf2202e4999c22356e0b372c9cbd996e61e68`.
- actual browser regression blob `22a684d18ee18849744d7eed6a8d2d21acdea1a9`.

Operator-entered observations are still not an authoritative oracle feed;
service/venue independent risk and execution evidence remains required.
No public deployment, installer, actual provider approval, signature, order,
transaction, canonical private session or Mac Computer Control is claimed.
Formal assembly/Host remains A wallet_release_owner. Shared inputs and other
owners are unchanged. Exchange UI child-owned dirty files were preserved and
excluded from this commit; overall worktree dirty is not a Quant source gap.
Report integration/execution gaps to 接续测试网生态审计工作 only.
