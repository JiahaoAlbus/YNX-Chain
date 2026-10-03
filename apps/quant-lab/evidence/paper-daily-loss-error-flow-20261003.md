# Daily loss rejection: exact API and user recovery

Predecessor 69832438799a56b8fc7e3ac7906c2c3bf1d2324a. Ordinary owned
backend/UI/tests only; no new grant, trade, shared SDK or formal publication.

Previously the new loss predicate returned a generic forbidden error. Added
ErrPaperDailyLoss wrapping ErrForbidden for existing errors.Is consumers.
The existing problem envelope returns HTTP403/error=paper_daily_loss_limit,
retaining random errorId/requestId and exposing no balance/session secrets.
An actual service HTTP test seeds a saved strategy and Paper position, accepts
a lower market tick, and proves the precise rejection plus persisted breach
with no added order.

UI maps only this exact error on HTTP403 from /v1/paper/orders. It clears the
definitively rejected local pending intent, refreshes current persisted risk,
and shows the existing daily-model explanation in the current language. An
unsuccessful readback cannot turn rejection into success. No automatic order
retry, signing request, or Standard Wallet change. Unknown/network/conflict
outcomes continue to retain their original uncertain intent.

Local checks:

- Actual mobile Chrome controlled403 flow PASS (3.025s): one explicitly
  confirmed POST, updated breached inspector, pending intent gone, Arabic
  language switch updates same toast, reload no extra POST.
- Business55/55PASS includes all12 locale changes and zero auto-retry/proofs.
- Real Go HTTP predicate test plus race suite PASS; vet/syntax/diff PASS.
- Actual PostgreSQL six gates twice12PASS; database full stop/start then
  full regression105top-levelPASS. Optional NodeHost browser gate remains SKIP
  in this Go-only run, separately executed in preceding evidence. Cluster
  stopped, state/nonce rows0|0, productionDB=false.
- Full npm65 cases64PASS/1FAIL at existing formal
  QUANT_ASSET_HASH_MISMATCH:styles.css. This remains a release blocker;
  unique integrator must freeze the complete compatible asset graph.

Actual PG receipt retained at
`/private/tmp/ynx-quant-postgres-it-zqXJS9/receipt.json`.
Focused log SHA256
`ad648c59f3231e34973b4974b2d6ac81a1a4477e9a39e41b557e680c8e9dab07`;
full log SHA256
`9891d420903bdf003e89536275a117e5d547991c2ff0ad0faa336019d289a0e0`.
Public/current-source provider, real orders/transactions/native installation
and aggregate completion remain unproven; local controlled browser routes are
not public runtime evidence.
