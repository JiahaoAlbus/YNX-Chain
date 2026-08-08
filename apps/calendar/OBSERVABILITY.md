# YNX Calendar observability

Runtime source: `fb98415c90379f9819eaebcf30292fafda132ca3`

## Current local evidence

- `/v1/health` returns Calendar product and build truth without claiming production scheduling.
- Service smoke verifies startup and core HTTP flow.
- Browser proof records desktop/mobile rendering, named controls and zero console errors.
- Calendar state mutations produce local audit entries.
- Backup/restore CLI returns structured JSON with operation, product, relative target, schema version, digest, counts and `liveStoreModified` truth.
- Integrity failures return bounded errors rather than silently loading state.

## Required structured fields

Runtime logs and cross-product events should carry, where applicable:

- `timestamp`, `level`, `service`, `productId`, `buildCommit`;
- `requestId`, `auditId`, `errorId`, `sessionBindingHash`;
- `actorHandleHash`, `eventId`, `eventVersion`, `seriesId`, `mutationId`;
- `operation`, `result`, `source`, `asOf`, `schemaVersion`;
- `provider`, `providerRequestId`, `model`, `costState` for AI;
- `deliveryId`, `deliveryState`, `attempt` for Mail/push;
- `backupEnvelopeVersion`, `stateSchemaVersion`, `stateDigestPrefix`, `restoreResult` for recovery.

Do not log event titles, descriptions, links, notes, attendee addresses, session tokens, HMAC keys, backup bodies, local absolute paths or provider secrets.

## Metrics contract candidate

- HTTP request count, latency and error rate by bounded route template/status.
- Active sessions and failed Wallet verification by reason class.
- Event previews, approvals, rejects, reverts and version conflicts.
- Recurrence expansion latency and generated occurrence count.
- Reminder due, delivered, duplicate-suppressed and provider-failed counts.
- AI jobs by state, provider, model and bounded cost state.
- Backup duration, bytes, age, restore duration, restore result and digest-match boolean.
- State bytes, event count, audit growth and write duration.

No metrics endpoint, trace exporter, dashboard or alert route is currently accepted. These remain owner `13-monitor` and `30-security-platform` dependencies.

## Alerts candidate

- State HMAC or backup HMAC mismatch: page immediately.
- Future/unsupported state schema: high-priority deployment rollback alert.
- Repeated reminder duplicate suppression or delivery failure: high.
- Wallet verifier rejection spike: high, split by bounded reason.
- Restore failure or digest mismatch: high; live state remains untouched.
- p95 mutation approval latency or state write latency above accepted SLO: warning/high according to duration.
- Public route, source commit or release-state mismatch: release alert; keep public flags false.

## Trace boundaries

Traces may include request, mutation, audit and provider identifiers but must not include private Calendar content. Wallet, Mail, AI and Data Fabric spans must retain authority boundaries and exact dependency version. A local span is not proof of central delivery or acceptance.

## Incident evidence

Preserve:

- exact runtime source commit and configuration version;
- bounded error and request IDs;
- state/backup schema versions and digest prefixes;
- affected time window and counts;
- central dependency health/version;
- recovery command result and isolated target identifier;
- test or public probe output.

Do not attach raw state, backup content, secrets or private event data to public incidents.
