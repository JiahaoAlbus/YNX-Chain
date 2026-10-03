# Finance indexed record traceability — local source checkpoint

Inherited parent: 1c8a2742ce8ca164e2219a3d28e7758cfe9da25d / tree 7b3c992f2013c65ebbcab36197ed7a7505dc4f9c. Only ordinary Finance UI and direct tests changed; no Wallet, authority, Host, deployment or backend mutation.

Existing read-only contracts: internal/finance/upstream.go maps Explorer tx.Hash to Activity.id and stamps source `ynx-explorerd:indexed-transaction`; SourceStatus.source carries the configured Explorer base. internal/explorer/explorer.go resolves transaction deep links as `/tx/<hash>`. No endpoint was invented or hard-coded.

Activity references now disclose the exact escaped full ID through a native details/summary control. Only indexed-source rows with a canonical 64-hex hash, available Explorer status and HTTPS root URL get an Explorer link. Credentials, scheme-relative, HTTP, executable schemes, API subpaths and query/fragment-bearing bases fail closed. Other IDs remain local references; Pay/internal order IDs are not promoted to chain transactions. Hash text wraps and remains selectable, including RTL layouts. No new translated label: existing 12-language explorerEvidence is used.

Initial controlled Chrome regression failed waiting for the link: the existing URL helper supplied about:blank's invalid origin as base even for absolute HTTPS URLs. Absolute URLs now parse independently; relative URLs still require the actual HTTPS origin. Failure retained: focused 5/6, grouped 53/54. After correction: focused 6/6 (4443.398666 ms); seven ordinary owned Finance groups 54/54 (41197.770834 ms). New case directly renders the real UI, expands full hash, checks exact href, rejects unsafe URLs/source markers/internal IDs/HTML injection/unavailable source, and observes zero requests, one tab and zero page errors.

Commands: node --check apps/finance/web/app.js; node --test apps/finance/tests/{overview-source-browser,owned-read-controller,owned-save-controller,owned-save-browser,owned-ai-controller,owned-ai-browser,product-response-recovery}.test.mjs; git diff --check.

Public deployment, native install, live Explorer navigation, real provider approval, Product Session v2 and transactions remain NOT_VERIFIED. Release owner must bind compatible backend/frontend source and versioned assets; this checkpoint does not override formal hash pins or authorize deployment. Rollback is a normal revert of this Finance-only commit, not a reset of inherited history. Remaining Exchange accepted v2 write-producer and formal source-bound release gaps were sent to 接续测试网生态审计工作.
