# Faucet delivery, quotas and receipt recovery

The standalone site is served by `ynx-faucetd` (or its exact immutable static asset release) on `faucet.ynxweb4.com`. Its CSP must allow same-origin `connect-src`, scripts and styles. All API results and the HTML use no-store. Addresses are checksum-validated and canonicalized before submission. No wallet signature or private key is needed.

## Durable production configuration

Use `YNX_FAUCET_UPSTREAM_MODE=authoritative`, chain 6423 and the Core `ynx-faucet-request-v1` capability. Both services read `YNX_FAUCET_CORE_AUTH_TOKEN_FILE=/etc/ynx/faucet-core-auth.token`: a private ordinary non-symlink file, mode 0600, owned by their service account, containing 64 lowercase hex characters and an optional newline. Never publish its contents. This token is independent of BFT signers.

Set `YNX_FAUCET_ADMISSION_DB` to a persistent private path and retain it with `YNX_FAUCET_REQUEST_LOG`. The admission is synced before its upstream write; the same request ID and recipient/amount binding survive retries and restarts. Do not delete the database or log to remove limits or repair startup. A legacy backend cannot safely replace the durable backend after admission begins.

`YNX_FAUCET_RATE_LIMIT_MAX` (default 1) and `YNX_FAUCET_RATE_LIMIT_WINDOW` (default 1h) apply to the canonical receiving address across networks. The independent `YNX_FAUCET_IP_RATE_LIMIT_MAX` (default 100) and `YNX_FAUCET_IP_RATE_LIMIT_WINDOW` (default 1m) provide a wider shared-network abuse budget. Admission IDs replay without charging either budget again. The v2 quota migration preserves historical charged pair records, including uncertain upstream errors; it never resets the previous allowance. At the reverse proxy, overwrite `X-Real-IP` with the actual remote host. The application only trusts that header from a loopback proxy.

## Read-only reconciliation

The browser persists the exact intent before POST. Durable pending requests poll `GET /request-status?requestId=…` without creating a new intent or minting. Unknown admission returns 404 `not_admitted`; unresolved admission returns 202 `pending`; verified receipt returns 200 `accepted` and the original transaction. The service checks Core `/v1/native-transactions/{deterministicHash}` and accepts only `durable` or `pending_durable` status with the local snapshot proof and exact recipient, amount and transaction hash. `memory_only`, `uncertain`, missing transactions and unavailable reads never become success. Local durability is not consensus finality.

Legacy services did not receive the browser-generated ID. These requests must not be automatically upgraded to a new durable write. The static `legacy-receipts.json` is an operational, audited migration registry, empty in source. An operator may add an exact browser intent binding only after correlating the original service log, transaction, successful receipt and recipient/amount. It must use schema `ynx-faucet-legacy-reconciliation-v1`; no private logs or client IPs belong in this public data. The browser validates ID, canonical recipient, chain and amount before restoring the original receipt. Balance alone is never proof. Preserve the operational registry when making the next immutable web release.

HTTP status is retained even for plain-text errors. A definite 400 releases the invalid input; a definite 429 retains an unsubmitted intent for explicit retry. Missing or uncertain acknowledgements preserve the pending intent. Refreshing availability or recovering a receipt never initiates another funding request.
