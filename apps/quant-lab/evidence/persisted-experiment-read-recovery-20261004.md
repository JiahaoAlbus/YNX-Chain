# Persisted experiment result / curve recovery — ordinary local evidence

Product source: 65f9ec9ad8c22ae1b72ffd0fcbb82f8d4af74534
Tree: f47c87dcf8d7f494131ab78a64df6cb9f69f7eaf
Final visual fixture: b4171a0406a6a8497296d62691a2a3bea8f8e102
Tree: d5ef42acd27252bfa9806548a530d57dbe6ef489
Branch: codex/exchange-sso-cookie-binding-20261002
app.js blob: 306db99da241e843896412db5a2be7cb7b64051c
index.html blob: 828c739f9d03780967d66a3f32521ebe9e424fc9

## Existing research flow completed

The original engine persists full completed experiments, equity/benchmark
curves, costs and metric definitions. Previously history showed numeric
columns only; cold reload offered no user action to reopen that persisted
result. A local View completed result action now displays the exact selected
experiment with its ID, strategy name, source time, assumptions, formulas,
source digests and measured curve through the existing result renderer.

The result heading no longer calls an arbitrary historical selection the
latest result. Source *Micro attribution and metric boundaries remain.
Saved and temporary provenance stay separate even with identical experiment
IDs. Failed/running/malformed experiments have no open action; forged indexes
and stale render epochs cannot select a replacement row. Opening history only
reads current admitted snapshot/page data and navigates to Research. It makes
no HTTP request, reruns no experiment and requests no Wallet proof.

## Actual verification

node --test apps/quant-lab/tests/business-flow.test.mjs
  apps/quant-lab/tests/research-recovery-browser.test.mjs:
108 PASS, 0 FAIL, 0 SKIP; 16731.071125 ms.

The actual Go original research engine ran against explicitly controlled
local tape. Two independent actual Chromium contexts cold-reloaded through
service restarts, reopened their own exact stored engine experiment via the
real history button, and compared full receipt/curve and fee assumptions.
All 12 locale actions retained the selected exact receipt. Research request
counts did not increase from history reads. Existing unknown-return replay,
schedule confirmation/stop, risk/Paper guard and measured negative-equity
recovery checks remain. All four Go service launches drained cleanly.

The first combined run was 107 PASS / 1 FAIL: an old cost-column fixture used
the last five table cells and now included the new action cell. It now
asserts 17 total cells and exact original attribution columns 11–15,
preserving every original absent/unsafe/currency/zero-cost assertion. This
failure was not suppressed.

After adding the visual capture the actual Go/Chromium case passed again:
1 PASS / 0 FAIL / 0 SKIP; 16326.869375 ms. Image inspection found that capture
retained the user's preceding Arabic selection despite an -en filename.
The fixture now explicitly selects English before capture, with no request
or source rewrite. Final actual case: 1 PASS / 0 FAIL / 0 SKIP;
14260.134125 ms (13931.022458 ms case), four clean stops.

node --check app.js, business-flow.test.mjs and
research-recovery-browser.test.mjs; git diff --check: PASS.

## Retained local artifacts

Final retained QA root:
/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-O421XU

Go QA executable: 11516786 bytes,
SHA256 59c960666ac41a254e27eb6d6a9d1626ff19450f181627a7ca4f737236dade9a.
This unchanged Go executable hash is not a formal Web or installed release
binding. The original Go server reads the owned Web assets locally.

Actual 390px English reopened-result image, visually inspected and copied
byte-exact into owned evidence:
saved-experiment-reopened-20261004.png, 242522 bytes,
SHA256 9dfa9b81db55aa14db054f685f95392236939ba89dea01b3472d4971e3d42182.
Controlled source/parameters/formulas/curve are visible; no account/private
key/credential is present. This is browser-local evidence, not macOS
ComputerControl or public acceptance.

## Unproven release gates

No shared SDK/Auth/permission/authority, apps/quant, DEX, Wallet, formal
bundle/pin, Host, public deployment or installed artifact changed.
Public current-source runtime, real Wallet/account approval/callback,
sign/EIP712/transactions, canonical Product Session and user acceptance
remain unproven. Source/tests/screenshots cannot establish those gates.
The existing protected matching composition and formal release are still A's
scope; this owner source should be included in that exact compatible graph.
Coordination: 接续测试网生态审计工作,
01a094cc-0ba3-7901-bcd5-56fce8330c0d.
