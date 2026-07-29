# YNX Mail Dependency Acceptance

Version: 1.1.0  
Implementation source commit: `f6868eccc2e47a2cde137b7b4238fa6bcce3a657`  
Product owner: `25-mail`  
Status: Mail-owned adapter implemented and tested; central acceptance pending

## Accepted local boundaries

YNX Mail owns its Mail state, native `@handle` mailbox behavior, draft/send/retry
workflow, sender attestation, delivery truth model, provider adapter, provider
webhook verification, persistent suppression, bounded sender-scoped dead-letter
recovery, local provider health evidence, export/delete, Mail-specific audit
records and a transactional, bounded, private-minimized Data Fabric outbox with
persistent sequence and acknowledgement state.

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
| 26 Data Fabric | Canonical delivery/audit/billing event envelope and authenticated ingestion transport | Transactional pull/ack outbox, privacy tests and vectors at implementation commit `f6868ecc`; no public transport route | Mail-owned adapter accepted locally; central schema/transport acceptance pending |
| 13 Monitor | Provider health, webhook failure, bounce/complaint, suppression and queue alerts | Mail exposes local evidence, suppression count and open dead-letter count | Not integrated |
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

`go test ./...` on 2026-07-29 passed the Mail package and all tested shared
packages except Developer-owned BFT/Consensus IDE tests, which could not find
`artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json`.
Mail does not create or modify that owner artifact; 11 Developer and 29
Integration must restore the canonical generated artifact before a shared
repository preflight can pass.
