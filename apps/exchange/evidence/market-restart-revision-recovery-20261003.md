# Exchange market restart revision recovery

Parent checkpoint: 5357751a3767d6ee4b28815be0896d9426e9cf7b.
Only ordinary direct market-feed test/evidence changed; no runtime or authority
change. Source inspection found existing revision/epoch fences, so no invented
runtime fix was made.

Added a combined adversarial transport test: verified revision 9, disconnect,
restart response revision 1 rejected with MARKET_DATA_INVALID while original
snapshot stays stale, old stream events/errors ignored without extra timers,
2000ms retry restores unchanged persisted revision 9, second disconnect uses
reset 1000ms backoff and recovers revision 10. Offline then ignores all retired
streams and clears all timers. All reads are same-origin GET without credentials.
Received revisions exactly [9,9,10]; no reset state or synthetic newer trade is
accepted. Explicit no-credential read contract remains unchanged.

`node --test apps/exchange/tests/market-data.test.mjs`: 35/35 PASS, 0 skipped,
79.634083ms. `git diff --check`: PASS.

Scope: deterministic injected HTTP/SSE transports, not an actual venue restart,
public network outage, real users, wallet approval or orders. This proves the
direct client recovery state machine only. Public/installed/migration gates
remain unverified. Unique release owner must integrate this ordinary test delta
separately; no inherited checkout deployment. Rollback is this test/evidence
delta only. No service, Host, account, signing or transaction action occurred.
