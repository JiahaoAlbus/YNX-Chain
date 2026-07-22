# Observability

Gateway and sponsor events use structured JSON with timestamp, level, service/version, request ID, error ID, audit ID, product client, hashed device/account binding, operation/intent digest, outcome, latency and authoritative source. Logs exclude seeds, private keys, recovery material, raw Credential evidence, bearer material, signatures and provider secrets.

Metrics cover authorization request/approve/reject/complete, introspection outcome, expiry/revoke/logout, replay/tamper/cross-App rejection, UserOperation simulation/submission/receipt, Paymaster eligible/ineligible reason, budget consumption, provider latency/rate limits, queue age, Credential status failure, mandate kill/exit and artifact download/install verification. Traces connect Wallet callback → Gateway → Bundler/Paymaster with request ID, never secret fields.

Alerts: p99/SLO burn, replay surge, signature/tamper surge, sponsor budget at 50/75/90/100%, Paymaster deposit threshold, Bundler outage, queue age, revoke failure, backup lag, audit-chain failure and public artifact hash mismatch. The incident runbook is in `OPERATIONS.md`. Status-page and central monitor URLs remain operator inputs until deployed.
