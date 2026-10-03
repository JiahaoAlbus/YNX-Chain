# Market response framing and visible recovery

Base 517d54a078feefad7a7f777bb3273da9a8711c54. Owned public-market consumer only; no shared auth, permission, producer, endpoint, matching engine, DB schema, formal release or Host change.

The feed bounded total bytes but did not compare actual identity-body bytes with declared Content-Length. A new regression first failed: a mismatched response advanced revision 1 to 2 instead of retaining the verified snapshot (12.85125ms). Fix compares identity/unencoded responses only, rejects overrun immediately, rejects incomplete length at EOF and retains the existing decoded 8 MiB limit. Browser-decoded gzip/br bodies are not incorrectly compared with compressed wire lengths.

Executed:

- Length smaller/larger/zero rejected, verified old snapshot retained as stale, stream retired, explicit correct read recovered revision 2. All requests remain same-origin public GET with credentials omitted.
- Correct identity length and browser-decoded compressed cases accepted. Open stream overrun cancels immediately once, without waiting for EOF/deadline. Existing split UTF8, corruption, deadlines, rate limiting and revision/provenance checks preserved.
- Five-group market/preview/candles/locale/owned-controls regression: 75/75 PASS, 28375.021708ms.
- Extended actual installed Chrome candle journey with mismatched identity response: old trace rows and match digest remain, stale label stays visible, correct explicit retry changes returned chart values; one tab. Focused final browser PASS, 1144.815542ms.
- Final market/preview regression including immediate overrun cancellation: 44/44 PASS, 92.143041ms. Node syntax and git diff checks PASS.

Controlled local transport/readback fixtures are not public market provenance or real Wallet/account/order evidence. Standard/private authority is unchanged. Current public source binding, accepted write producer, real account approval, signatures, orders, native install and ComputerControl are still unverified. The already reported read-only/write capability gap remains the shared owner's implementation task; do not bypass it or fake a submission. Include this product delta in A's compatible release graph with actual version/assets/backend identity and rollback, not an old-runtime frontend overlay.
