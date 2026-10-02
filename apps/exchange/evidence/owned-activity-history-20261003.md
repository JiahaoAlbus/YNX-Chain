# Exchange existing account history consumption

Source baseline: 224960c41fb672091fb385179f45b2b4077623fa.

The existing approved account snapshot contains orders, ledger entries, deposits and withdrawals, but the Activity page previously exposed only trades, fees and audit. Completed/cancelled/rejected orders disappeared from the open-order view with no history surface. This change consumes the existing arrays; it does not add an engine, financial product, API, permission, signature or write request.

The Activity page now provides Order history, Asset ledger, Deposits and Withdrawals beside its existing tabs. It displays actual IDs, full source/audit digests, signed available/reserved ledger deltas, filled amounts, rejection reasons, confirmations and raw venue states. Withdrawals preserve returned amount/fee/receive separately. Venue records are explicitly not independent proof of chain completion. No synthesized transaction hash, settlement or Explorer target is provided.

All branches filter records to the current approved account, render text rather than markup, sort a copy newest-first with an ID tie-break, and clear headings/rows when the snapshot is absent. The page never mutates the source snapshot. Tabs wrap on narrow screens, retain actual product click handlers and have 44px minimum targets. Wide record tables scroll inside their panel rather than widening the page.

Validation command:

`YNX_EXCHANGE_CONTROLLER_HTTP_QA=1 node --test apps/exchange/tests/private-account.test.mjs apps/exchange/tests/owned-controls-browser.test.mjs`

Result: 29/29 passed, zero skips, 8.758 seconds. The new real Chrome DOM test executes the actual renderer and product tab binding against controlled records: filled/cancelled/rejected history, negative/zero ledger values, exact digest, pending deposit/withdrawal states, HTML-like text safety, A/B isolation, absent-snapshot clearing, source immutability and 390px page containment. Other tests include actual local Go HTTP/Chrome host-only identity consumption and authoritative logout failure. Controlled records/SDK fixtures are not real user approval, production data, public transactions or installed QA.

Node syntax and `git diff --check` passed. Shared Wallet/Auth and all Host/release paths remain unchanged. Existing English-only Exchange Web localization remains an inherited incomplete requirement; this change does not claim full multilingual acceptance. Release owner must include these ordinary product files in the coherent final asset graph. Public/install/account approval/business write gates remain unverified. Source rollback: revert/omit this isolated UI delta then rebuild through the sole release owner; no production rollback performed.
