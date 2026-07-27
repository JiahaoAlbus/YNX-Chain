# YNX Calendar integration handoff

## Authority and source

- Owner: `36-calendar`
- Product ID: `com.ynx.calendar`
- Product client: `ynx-calendar-v1`
- Bundle ID: `com.ynxweb4.calendar`
- Callback: `ynxcalendar://wallet-auth/callback`
- Runtime source: `4ed42274a7abca2aaea0a426faa1c5548f8fd63e`
- Contract: `release/integration/calendar-contract.json`
- Status: local-tested proposal; not centrally accepted or deployed

Calendar owns event, invitation, RSVP, recurrence, reminder, sharing, conflict, local audit, and Calendar-specific privacy state. It does not own Wallet identity/session truth, Mail delivery, AI provider execution, Data Fabric transport, central protocol freeze, release security, or public Website deployment.

## Frozen local behavior

The local Calendar runtime uses explicit preview and approval for event mutations. Mutation IDs are idempotent, event versions are checked before update/cancel, and conflicts require a separate explicit override. Calendar never silently reschedules an event.

Recurrence schema version 1 supports daily, weekly, monthly, yearly, interval, count, until, weekly `ByDay`, monthly `ByMonthDay`, and single-occurrence `cancelled` or `modified` exceptions. Exception IDs are the original local start in the series IANA timezone. Invalid month days and non-leap February 29 dates are skipped rather than rolled forward.

The schema implementation is local-tested. Explicit occurrence-only and this-and-following HTTP mutation operations are still pending and must not be inferred from the schema alone.

## Wallet/Auth handoff

Owner `02-wallet-auth` must accept and deploy:

- Calendar registry tuple and exact callback;
- `calendar:account` and `calendar:recover` scopes;
- central verifier/introspection response binding;
- expiry, revocation, recovery, device/session binding, and replay evidence.

Calendar already has a fail-closed remote verifier adapter and local negative tests. `integratedCentral` remains false until direct deployed evidence is recorded.

## Mail handoff

Owner `25-mail` must accept a versioned delivery envelope for:

- invitation created;
- invitation updated;
- RSVP changed;
- event cancelled;
- reminder due.

Every envelope needs a stable idempotency key, Calendar event/version, actor/recipient handle references, privacy class, source commit/schema version, `asOf`, request/audit ID, and delivery outcome. Mail must not become the Calendar state authority, and Calendar must not claim delivery when Mail is unavailable.

## AI handoff

Owner `14-ai` must provide an authenticated JSON POST/SSE endpoint. Selected Calendar context must not appear in URL query parameters or provider-visible logs beyond approved prompt content. Provider, model, cost, request ID, cancellation, and failure state must be returned truthfully.

AI may draft, explain, summarize, or preview. It may not invite, RSVP, cancel, reschedule, share, delete, or send notifications without a separate user-approved Calendar operation.

## Data Fabric handoff

Owner `26-data-fabric` must freeze transport for the proposed Calendar events in the contract. The envelope must preserve Calendar authority, privacy class, source/asOf/version, audit ID, idempotency/replay key, and schema version. Data Fabric may transport or index Calendar events but may not redefine Calendar event state.

## Shared Testnet acceptance

Owner `29-integration` should execute `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json` in order:

1. Wallet binding/replay rejection;
2. two-user invite→RSVP→update→cancel with Mail delivery;
3. recurrence/DST/exceptions and mutation scopes;
4. sharing/revocation and privacy-safe availability;
5. conflict override and offline recovery;
6. AI preview/approve/reject/cancel;
7. current-source platform install/cold-start;
8. public Website truth probes.

Acceptance must record exact source commits, central dependency commits, request/audit IDs, artifact hashes, and public URLs. Local fixtures or the historical `e227c4f` preview release cannot be used as proof for the current runtime source.

## Release state at handoff

| State | Value | Evidence boundary |
|---|---:|---|
| implementedLocal | true | current source contains working Calendar runtime and clients |
| testedLocal | true | Calendar unit/Race/Web/browser/build/smoke gates pass |
| installedLocal | false | current source has not completed all-platform install/cold-start proof |
| integratedCentral | false | Wallet/Mail/AI/Data Fabric acceptance is missing |
| deployedStaging | false | no direct staging proof |
| deployedPublic | false | no direct public runtime proof |
| downloadHosted | false | no current-source immutable artifact is hosted |
| productionSigned | false | only historical debug/unsigned evidence exists |
| storeReleased | false | no store evidence |

Historical test-only downloads from `e227c4f0505537b19f4588ea26478c54518f0a4c` are tracked separately and must remain visibly classified as older preview artifacts.

## Integration blockers outside Calendar ownership

The repository-wide Go gate currently fails in unrelated consensus signer-permission tests, missing IDE contract artifacts, Faucet signer permissions, and Trust signer permissions. Calendar package tests pass. These failures must be resolved by their owners and revalidated by Integration; Calendar will not modify those modules from this worktree.
