# Finance associated Broker read ownership

Parent source: 217ea0b6cc6f5f073caad618753113de5fb5d538.
Ordinary app display delta only; no shared identity/permission/SDK change.

Extend snapshot display ownership to existing workspace reads: each read has a
sequence and existing state.context. Stale success returns null; stale failures
do not replace current orders with unavailable. Sign-out remains guest, with no
new private request. Public asset-search results/errors are context-bound, so
an old search cannot erase a new-account selected asset or draft. Public quote
results/errors bind context, sequence, selected symbol and current form symbol.
Even an invalid subsequent quote attempt retires its older pending result.

Current source failures and malformed responses retain their existing unavailable
behavior. No amount, status, order, quote source, provider permission or execution
protocol is invented. No automatic write, private approval or financial business
module was added. Existing pending authorization/outbox data is untouched.

Executed actual production-function VM tests plus existing actual Chrome display
test and full broker-execution-browser regressions: 33/33 PASS, no skips, total
17582.3585ms. New cases exercise old success and failure after account switch or
same-account later read, changed/invalid-new quote symbols, and preservation of
selected assets/drafts after old public-search completion. Browser cases retain
English default/12 locales/390px, source failures, callback scrubbing and existing
fail-closed execution boundaries. JS syntax and git diff --check PASS.

API/authorization values in these local tests are controlled fixtures, not
canonical public authentication, real provider approval or Broker fills. Public
current-source, installed flow, real Wallet/private session/personally owned
business remain separate unverified gates. Integrate only the three ordinary
read-function hunks into the release owner's current coherent app; do not replace
its authority/SDK graph with this inherited app. No Host/public/config/account/
signature/transaction action occurred. Source rollback is this isolated delta.
