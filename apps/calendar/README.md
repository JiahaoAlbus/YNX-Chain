# YNX Calendar

YNX Calendar is an independent Web/PWA and Go service for handle-based
scheduling with explicit previews, conflict review and reversible changes. This
repository does not claim a production scheduling network.

## Run

```bash
YNX_CALENDAR_DATA_DIR=./var/calendar \
YNX_WALLET_VERIFY_URL=http://127.0.0.1:8080 \
YNX_AI_GATEWAY_URL=http://127.0.0.1:8084 \
YNX_AI_GATEWAY_TOKEN=server-side-token \
go run ./apps/calendar
```

The service listens on `:8096` by default. Wallet verification must bind
`com.ynx.calendar`, the exact account or recovery scope, one-time challenge,
device key and expiry. Ordinary event, invite and sharing responses expose
`@handle` values, never Wallet addresses.

## State and security boundaries

- Events, recurrence, invitations, RSVP, sharing, reminders, mutation IDs,
  change previews, AI approvals and audit records are atomically persisted.
- Create, update and cancel first create a `preview`; approval is a separate
  operation. Version checks reject stale offline writes. Every applied preview
  can be reverted if no later write has changed the event.
- Offline mutations are stored on the device and synchronized only into a
  server-side preview. Reconnection never auto-approves, invites or changes an
  event.
- IANA time zones are mandatory. Daily, weekly and monthly recurrence preserves
  local wall-clock time across DST, while stored occurrences use UTC.
- Conflicts are detected before approval. Overriding one requires an explicit
  approval flag and is recorded in audit metadata.
- Invites and shares accept known local `@handle` identities only. RSVP is
  limited to invited users. Sharing can be removed by the owner.
- Meeting links must be HTTPS, contain no embedded credentials and cannot use a
  wallet/signing boundary. The link is navigation only; it grants no Calendar,
  Wallet or meeting-provider authority.
- Reminder delivery is local-product evidence, not email or push delivery. A
  persisted scheduler records normal and restart-recovered late reminders and
  never duplicates an occurrence.
- AI reads only selected event IDs. Provider/model/cost preview, approval, SSE
  state, cancellation, review and audit are implemented. Applying an AI result
  retains a suggestion; it does not modify, invite, cancel or automate.

## Main states

Change: `preview` -> `applied` -> optional `reverted`.

Event: `draft` -> `scheduled` -> `cancelled`; cancel itself uses the change
preview state machine.

Invitation: `preview` -> `pending` -> `accepted | tentative | declined`.

AI: `preview` -> `running` -> `review | failed | cancelled` ->
`applied | rejected`.

## Verify

```bash
npm test --prefix apps/calendar
npm run build --prefix apps/calendar
npm run smoke --prefix apps/calendar
go test ./internal/calendar ./apps/calendar
```

The browser-proof script launches ephemeral Calendar and Wallet-verifier
processes and writes desktop/mobile screenshots under
`apps/calendar/tests/artifacts/`.
