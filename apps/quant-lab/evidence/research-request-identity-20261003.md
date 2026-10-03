# Quant completed-result request identity

Predecessor b688a54a9190e8f41aea8ee37468ce96b6b18d2c. Owned app and direct tests only; no algorithm, capital execution, Wallet/Auth, final graph or Host changes.

The current form generates a unique strategy ID for each explicit request. Existing Go RunBacktest preserves that ID in Experiment.Strategy.ID. The previous browser fence compared parameters, seed, family and costs but omitted the ID, allowing another request with identical assumptions to be displayed as this completed result. A direct shipped-function regression failed before the change (true instead of false).

The response must now return the exact submitted strategy ID. Missing/null/empty/foreign IDs fail the request consistency check. This is correlation, not cryptographic engine/source authenticity. Invalid acknowledgement preserves prior verified results, releases the form and does not automatically replay a POST.

Controlled fixture updates accurately echo each submitted ID without mutating the fixture result reused by later requests. The actual local Go HTTP test supplies the actual request ID to the shipped fence and proves foreign-ID rejection. The actual Chrome test receives an otherwise valid completed result with a foreign ID, keeps the prior result, unlocks the form and creates no extra tab. It waits for the current response/busy completion rather than reading a previously visible toast.

Validation command: `node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/browser.test.mjs apps/quant-lab/tests/tenant-persistence.test.mjs`. Final result 66/66 PASS, zero skip, 47186.702458 ms. `go test -race ./internal/quantlab` PASS (2.660s); JS syntax and git diff checks PASS.

Early full runs correctly exposed outdated isolated fixtures (missing submitted IDs and reused object mutation), then a stale-toast browser assertion race; those failures were fixed in the fixtures, not hidden or bypassed. Real Go persistence, two-process/two-tenant replay and source-bound ordinary behavior are checked locally. No public source deployment, actual Wallet approval, real relay, installed package, real capital, order or transaction success is claimed. Source deltas must be integrated by the unique release owner without overwriting the accepted SDK/Auth graph.
