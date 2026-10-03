# Amendment multi-instance recovery

Inherited source: 3820602538fa70601803173cc50a9297055b9e21. Production engine logic remains unchanged from the d22c02413 fix.

Executed real loopback PostgreSQL 17.11 and two independent Exchange OS processes, not an in-memory persistence imitation. Twelve concurrent HTTP PUT /v1/orders/{id} requests with the original signed amendment returned HTTP 200 and the identical persisted cancelled effect. Both processes stopped; a third process recovered the same effect. Focused child PIDs: 20686, 20688, 20732.

Changed same-key requests return 409, a separately authenticated foreign owner returns 403, fresh intent after risk expiry returns 403, and a missing signature returns 401. Rejections must not include the original order ID. Native signatures and the existing local controlled Gateway fixture are used; no current Web v2 write grant is inferred.

After all requests the complete durable state digest is unchanged, including orders, fees and audit records; exactly one order and zero trades persist. Native test asset available balance remains 2*AmountScale and reserved balance remains zero. Both users' ledger reconciliations pass.

Focused race tests: PASS 5.673s. Final complete Exchange race suite with YNX_EXCHANGE_POSTGRES_TEST_URL configured: PASS 47.639s, including the added unsigned request fence. gofmt and git diff checks PASS.

The inherited loopback QA cluster is retained, not deleted. Test schemas use random per-test isolation and their normal cleanup. This is local multi-process/restart evidence, not a public deployment, installation, real Wallet approval, actual testnet transaction, or Product Session v2 business-write acceptance. A remains the sole formal Shared/Host publisher.
