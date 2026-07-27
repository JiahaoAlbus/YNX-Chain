# YNX Mail Dependency Acceptance

Version: 1.0.0  
Source commit: `13c2c7695c9e814ba54d066b6e3e1a03354b7d57`  
Product owner: `25-mail`  
Status: Active; central acceptance pending

## Accepted local boundaries

YNX Mail owns its Mail state, native `@handle` mailbox behavior, draft/send/retry
workflow, sender attestation, delivery truth model, provider adapter, provider
webhook verification, export/delete and Mail-specific audit records.

The Internet Bridge is fail closed. A provider API response can establish only
`provider_accepted`. A verified provider event can establish receiving-mail-server
`delivered`, `bounced`, `complained` or `failed`. Provider open/click telemetry
cannot establish YNX user-read state.

## Required owner acceptance

| Owner | Contract needed by Mail | Current evidence | Acceptance state |
|---|---|---|---|
| 02 Wallet/Auth | Registry entry, challenge/approval/gateway completion verifier, exact Mail scopes and callback | Remote verifier and negative tests exist locally | Pending central merge and live verifier |
| 14 AI | Product-session POST streaming route, provider/model/cost status and cancellation | Local selected-context preview/approve/review/cancel workflow exists | Pending central route |
| 15 Trust | Report/appeal case handoff and public/private evidence boundary | Local report, appeal and access controls exist | Adapter accepted locally; central handoff pending |
| 20 Cloud | Object references, malware scan, retention and delete propagation for large attachments | Inline bounded attachment integrity exists | Not integrated |
| 26 Data Fabric | Canonical delivery/audit/billing event envelope | Proposed vectors in `CROSS_PRODUCT_TEST_VECTORS.json` | Pending owner schema |
| 13 Monitor | Provider health, webhook failure, bounce/complaint and queue alerts | Health exposes configuration truth only | Not integrated |
| 28 Website | `/mail` canonical route, public metadata, support/privacy/security/status links | Historical metadata exists; current source has no public route | Not integrated |
| 29 Integration | Freeze this contract, resolve event names and merge order | `release/integration/mail-contract.json` | Pending acceptance |
| 30 Security/SRE | Secret references, public webhook, provider policy, backup/restore, artifact/release scans | Local HMAC/replay tests pass | Pending deployment and security evidence |

## Explicit non-acceptance

No owner should infer any of the following from the current source:

- a provider account or sender domain is active;
- SPF, DKIM or DMARC is configured;
- a public webhook is reachable;
- Internet delivery reputation is established;
- current-source Android, iOS or desktop artifacts are hosted or installed;
- Mail is centrally integrated, staging deployed, production signed or store released.

## Preflight conflict record

`go test ./...` on 2026-07-27 passed the Mail package but failed outside Mail
ownership in consensus key-permission tests, Faucet/Trust key-permission tests and
Developer contract-artifact tests. Mail does not modify those owners' worktrees;
29 Integration and the corresponding owners must resolve them before a shared
release preflight can pass.
