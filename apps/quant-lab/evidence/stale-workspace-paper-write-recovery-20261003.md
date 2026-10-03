# Quant stale workspace write recovery

Owner predecessor eb3c1a050be3543a24ecea82f4303310f4af6d73. Ordinary Quant UI/flow only; shared Wallet/Auth/SSO/SDK, grants, backend and formal release are unchanged.

Inspection found the existing failed-refresh path preserved its last confirmed Paper snapshot and warning but left fresh Paper submission and reconciliation available. Those operations should not treat stale observed risk/balance as current. The UI now blocks a fresh Paper intent and reconciliation until an explicit successful read. Error copy uses the existing twelve-language workspace warning, not a false kill-switch or sign-out message.

The independent stateful workspace authorization flag and last confirmed records are preserved. Kill switch remains available as a risk-reducing operation. An already-persisted uncertain Paper intent can still be explicitly confirmed and retried using the identical key/body; after its confirmed receipt is accepted and the pending key cleared, a still-failed workspace read cannot enable a new intent. No automatic retry was introduced.

## Executed gates

- `node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/ui.test.mjs`: 79/79 PASS, 508.632958ms. New cases cover stale fresh intent blocked before confirmation, no POST, unchanged workspace authority/cash, localized warning in all twelve languages, reconciliation blocked with kill available, explicit recovery, and exact uncertain replay without a new subsequent intent.
- `node --test --test-name-pattern='Paper|retains confirmed workspace' apps/quant-lab/tests/browser.test.mjs`: actual Chrome 5/5 PASS, 7500.818584ms. Retained cases cover explicit Paper confirmation, malformed receipt pending/same-key replay and unsafe amount rejection. The changed mobile case uses normal Paper navigation, selects an existing controlled saved strategy, sees enabled -> disabled on failed read -> enabled on recovery, confirms twelve-language stale warning, preserved workspace flag, no writes, no page errors and one tab. The first fixture attempt omitted normal Paper navigation and timed out on a hidden select; navigation was corrected without bypassing visibility.
- App/test Node syntax and git diff checks PASS.

Browser snapshots/authorizer inputs are controlled local fixtures; these are not public Wallet/account approval, real capital orders, Testnet execution, public multi-instance deployment or native installation. Existing shared write-proof/release integration gaps remain separately handed off. This check does not claim schedule start/stop authority or all stale-action policies are complete.
