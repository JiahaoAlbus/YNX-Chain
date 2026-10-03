# Finance ordinary statement response binding

Predecessor: 74488a2024268a440d1b4be27e1e621d157efe3e.
Scope: ordinary Finance report controller and tests only. No authority, SDK, endpoint, Host, release pin or other product edits.

The existing server statement response (internal/finance/server.go) includes account, from and toExclusive. The controller previously rendered a current-operation response without comparing those fields with the loaded workspace owner and requested period. It also allowed JavaScript calendar rollover for invalid day strings.

The controller now captures the loaded overview account, includes it in request coalescing/current-operation fencing, rejects invalid calendar days or reversed periods before API access, and requires exact returned owner and equivalent requested UTC boundaries before rendering. The existing renderer still rejects fabricated complete-period totals. Failure clears the statement and presents unavailable; an explicit correct retry recovers. No new identity authority or server protocol was introduced.

Executed local gates:

- Node app syntax and git diff --check: PASS.
- owned-read-controller: 9/9 PASS, including wrong owner, wrong dates, invalid dates, explicit retry, late response, account switch, export isolation.
- Combined owned-read-controller, owned-save-browser, standard-wallet-flow, overview-source-browser before adding the new browser case: 56/56 PASS, zero skips.
- Final overview-source-browser with the new actual Chrome statement controller/renderer case: 4/4 PASS (2946.953625 ms). Wrong account and exclusive end display unavailable; correct retry displays unknown full-period totals and clears busy state. One tab, zero page errors and zero network requests in this isolated fixture.

Truth: local source/tests only. Controlled Chrome fixtures are not public account, Wallet approval, private Product Session, installed application or real financial-operation evidence. Public publication remains the exclusive release owner's job. Shared Wallet release is currently held for its independently reported queued-request revocation security defect; this report does not alter that boundary.

Integration: transfer only ordinary statement controller/helper and test hunks; do not replace a release-owner app or its shared graph. Rollback is inverse of these owned hunks; no production action was taken.
