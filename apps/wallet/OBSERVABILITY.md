# Observability

Source commit: `2eb3198a99fcd98a1c6d56e3e99e97166ceab7f6`.

## Canonical Gateway runtime

`ynx-wallet-gatewayd` now exposes four loopback administrative interfaces without Product Session proof transport:

- `GET /health`: process health, persisted-state digest and truthful local/remote classification.
- `GET /ready`: separates `runtimeReady` from `publicDeploymentReady`; a healthy local process does not imply staging or public deployment.
- `GET /version`: exact source commit, release, canonical build time and Gateway/node/observability schema versions.
- `GET /metrics`: Prometheus text exposition with request count, in-flight requests, cumulative duration, response status by bounded route, bounded public error codes, structured-event sink drops, build identity and remote-deployment classification.

Every response carries a generated `x-request-id` and `x-trace-id`. Rejected or failed requests additionally carry `x-error-id`. A remotely classified process refuses startup unless the operator supplies a full lowercase 40-character source commit, bounded release identifier and canonical ISO-8601 UTC build time. A local process without those values reports `local-unbound` rather than inventing a release.

## Structured event boundary

The CLI emits one canonical JSON event per request plus structured startup/shutdown records. Request events contain timestamp, service, release/source commit, request/trace/error IDs, bounded route and method, HTTP status, public error code, duration, state digest, outcome and remote-deployment classification.

Events and metric labels exclude request bodies, Product Session proofs, authorization headers, private keys, seeds, recovery material, signatures, provider secrets and state paths. Route labels come from a fixed allowlist and error labels come from bounded public error codes. A failed event sink cannot fail an authorization request; the drop is counted by `ynx_wallet_gateway_events_dropped_total`.

Admission is part of the canonical Node Host at source `6b1f1f21a79861178ee7fc168ad21c2869296fd5`. `RATE_LIMIT` and `CONCURRENCY_LIMIT` responses use the same request/trace/error identifiers, state digest, no-store policy, bounded metrics and redacted events as protocol failures; the daemon no longer maintains a second unobserved rejection format.

## Required central observability contract

The central integration must extend correlation beyond the local host with authoritative audit IDs, product client, hashed device/account binding, operation or intent digest, source/version and outcome. It must cover authorization request/approve/reject/complete, introspection, expiry/revoke/logout, replay/tamper/cross-App rejection, UserOperation simulation/submission/receipt, Paymaster eligibility and budget consumption, provider latency/rate limits, queue age, Credential status failure, mandate kill/exit and artifact verification. Traces must connect Wallet callback → Gateway → Bundler/Paymaster without secret fields.

Required alerts remain p99/SLO burn, replay or signature/tamper surge, sponsor budget at 50/75/90/100%, Paymaster deposit threshold, Bundler outage, queue age, revoke failure, backup lag, audit-chain failure and public artifact hash mismatch. Status-page publication, durable telemetry storage, accepted dashboards and alert evidence remain central Monitor/operator inputs; the local host does not claim them.

## Verification and remaining boundary

- Wallet-owned package suite: 113/113 passed; the two excluded Developer deployment assertions still require their Owner's compiled fixture.
- `gateway-admission.test.mjs` plus `gateway-node-host.test.mjs`: 12/12 passed, including canonical admission identifiers, state digest, bounded metrics, redacted events, Node-only package subpath export, exact build identity and event-sink failure isolation.
- A real loopback CLI process returned health, readiness, version and metrics and emitted canonical structured events.
- `remoteDeployed=true` without the complete build identity failed startup.
- Machine-readable evidence: `proof/gateway-observability-local-2026-07-27.json` and `proof/gateway-admission-observability-local-2026-08-13.json`.

This is tested local runtime evidence only. Central App Gateway merge, durable telemetry storage, distributed trace propagation, Monitor dashboard/alert acceptance, staging/public endpoints and production SLO compliance remain unverified.
