# Data Fabric Producer Integration Test Vectors

Product owners must pass these vectors before central integration. Each vector proves a required contract boundary.

## Prerequisites

1. Product has registered an integrity key ID with Data Fabric operations (out of band)
2. Product has obtained accepted canonical Wallet/App Gateway session credentials
3. Product SDK wraps the canonical envelope and signs with the registered key
4. Product has a local or staging Data Fabric instance responding at the introspection endpoint

## Test Vector 1: Successful event append with transactional Outbox

**Requirement:** Product commits its authoritative state and Outbox event atomically.

**Setup:**
- Product database transaction begins
- Product business logic completes (e.g., invoice created, order placed)
- Product increments aggregate sequence deterministically

**Action:**
- Product signs canonical envelope with all required fields
- Product calls Data Fabric HTTP POST `/v1/events` with canonical credentials
- Data Fabric returns HTTP 202 with `{"status": "committed-to-outbox", "eventId": "..."}`

**Assertions:**
- Product transaction commits or rolls back as a unit
- If Data Fabric returns 202, product state and local Outbox marker exist
- If Data Fabric returns 4xx/5xx, product transaction rolls back and no Outbox marker exists
- Re-submitting the same event ID returns 409 Conflict after successful commit
- Aggregate sequence has no gaps when queried from product database

**Pass criteria:** Product demonstrates atomic commit of business state and Outbox in one transaction, and retry after timeout does not create duplicate business effects.

---

## Test Vector 2: Duplicate event ID rejection

**Requirement:** Data Fabric detects and rejects duplicate event IDs.

**Setup:**
- Product successfully appends event with ID `event.product.test.0001`

**Action:**
- Product attempts to append a different event with the same ID `event.product.test.0001`

**Assertions:**
- Data Fabric returns HTTP 409 Conflict
- Response body contains `"code": "duplicate"`
- Original event remains unchanged
- Second event is not stored or published

**Pass criteria:** Duplicate event ID is rejected even if payload differs.

---

## Test Vector 3: Sequence gap rejection for ordered aggregates

**Requirement:** Data Fabric enforces strict sequence for a given product/service/aggregateId.

**Setup:**
- Product has committed events with sequences 1, 2, 3 for aggregate `order.shop.0001`

**Action:**
- Product attempts to append sequence 5 (skipping 4)

**Assertions:**
- Data Fabric returns HTTP 409 Conflict with `"code": "out-of-order"`
- Response indicates expected sequence 4, received 5
- Event is not stored

**Pass criteria:** Gap in aggregate sequence is detected and rejected.

---

## Test Vector 4: Integrity signature tamper detection

**Requirement:** Data Fabric rejects events with invalid or tampered signatures.

**Setup:**
- Product creates a valid signed envelope

**Action:**
- Product modifies the payload after signing (e.g., changes amount)
- Product submits the tampered event

**Assertions:**
- Data Fabric returns HTTP 400 Bad Request with `"code": "tampered"`
- Event is quarantined (logged with alert context)
- Event is not stored or published

**Pass criteria:** Tampering is detected and rejected.

---

## Test Vector 5: Unknown field rejection

**Requirement:** Data Fabric uses strict decoding to reject unknown fields.

**Setup:**
- Product adds an unknown field to the envelope (e.g., `"unknownField": "value"`)

**Action:**
- Product submits the envelope

**Assertions:**
- Data Fabric returns HTTP 400 Bad Request
- Response indicates unknown field violation
- Event is not stored

**Pass criteria:** Unknown fields are rejected.

---

## Test Vector 6: Invalid version rejection

**Requirement:** Data Fabric rejects unsupported schema versions.

**Setup:**
- Product sets `"schemaVersion": "2.0"` (unsupported)

**Action:**
- Product submits the envelope

**Assertions:**
- Data Fabric returns HTTP 400 Bad Request
- Event is moved to dead letter with version mismatch reason
- Event is not processed

**Pass criteria:** Invalid version is detected and dead-lettered.

---

## Test Vector 7: Consumer idempotent effect with Inbox

**Requirement:** Consumer applies business effect and Inbox marker atomically.

**Setup:**
- Event is published to consumer's queue
- Consumer receives event ID `event.pay.invoice.0001`

**Action:**
- Consumer transaction begins
- Consumer applies business effect (e.g., updates invoice status)
- Consumer records Inbox marker with event ID and effect hash
- Consumer transaction commits
- Same event is redelivered (broker retry)

**Assertions:**
- First delivery: business effect is applied, Inbox marker is stored
- Second delivery: Inbox lookup finds existing marker, business effect is NOT re-applied
- Consumer acknowledges both deliveries without error
- Final state is identical to single delivery

**Pass criteria:** Redelivery does not create duplicate business effects.

---

## Test Vector 8: Saga compensation flow

**Requirement:** Product implements both forward action and compensation for its Saga steps.

**Setup:**
- Saga `shop-order-inventory-payment-fulfillment` is running
- Step 1 (reserve-inventory) completes successfully
- Step 2 (capture-payment) completes successfully
- Step 3 (request-fulfillment) fails

**Action:**
- Product coordinator initiates compensation
- Product emits compensation events in reverse order:
  - `shop.payment.refunded` (compensates step 2)
  - `shop.inventory.released` (compensates step 1)

**Assertions:**
- Data Fabric records compensation events with correct causation IDs
- Saga status transitions: running → compensating → compensated
- User-visible status shows "recovery-in-progress" → "recovered"
- Saga audit trail includes both forward and compensation event IDs

**Pass criteria:** Compensation is executed in reverse order and Saga reaches compensated state.

---

## Test Vector 9: Saga timeout and manual recovery

**Requirement:** Product handles Saga deadline expiration and manual recovery.

**Setup:**
- Saga `dex-swap-lp-vault` has deadline 60 seconds
- Step 1 completes at T+10s
- Step 2 blocks due to chain congestion

**Action:**
- Time advances past T+60s (deadline exceeded)
- Automated compensation fails (requires wallet approval)
- Product marks Saga as requiring manual recovery

**Assertions:**
- Saga status transitions to `manual-recovery`
- User-visible status shows "action-required"
- Saga failure reason is recorded
- User is notified and can approve recovery
- After approval, compensation completes and Saga reaches compensated state

**Pass criteria:** Timeout triggers compensation, manual recovery is user-visible, and approval path exists.

---

## Test Vector 10: Balanced journal entry with fee consent

**Requirement:** Product submits balanced double-entry journal with explicit fee consent for user debits.

**Setup:**
- User has accepted fee schedule v1.2 with consent ID `consent.user.0001`
- Maximum consented fee is 100 minor units
- Product completes a transaction requiring a 50 minor unit fee

**Action:**
- Product submits journal entry with:
  - Debit: user account, 50, category "user-charge"
  - Credit: protocol revenue, 50, category "protocol-revenue"
  - FeeConsent: consent ID, schedule v1.2, accepted timestamp, maximum 100

**Assertions:**
- Data Fabric validates total debits = total credits per asset/currency
- Fee consent references are validated (consent ID, schedule version, amount ≤ maximum)
- User account in debit matches the event actor account
- Journal entry is immutable after commit
- Ledger balance query shows correct user charge and protocol revenue

**Pass criteria:** Balanced entry with valid fee consent is accepted; unbalanced or missing consent is rejected.

---

## Test Vector 11: Journal correction flow (not overwrite)

**Requirement:** Corrections use new entries that reference the original, not silent overwrites.

**Setup:**
- Original journal entry `journal.pay.0001` recorded incorrect amount

**Action:**
- Product submits correction entry with:
  - New entry ID `journal.pay.0002`
  - `correctionOf: "journal.pay.0001"`
  - Reverse postings to nullify original
  - Correct postings

**Assertions:**
- Both original and correction entries exist in ledger
- Original entry is never deleted or modified
- Ledger balance calculation includes both
- Audit trail shows correction relationship

**Pass criteria:** Correction creates new entry and preserves original.

---

## Test Vector 12: Reconciliation with authoritative sources

**Requirement:** Product provides authoritative observations for reconciliation.

**Setup:**
- Journal entry debits 1000 minor units to chain settlement
- Product observes on-chain transaction with amount 1000

**Action:**
- Product submits reconciliation observation:
  - Source: "chain"
  - Reference ID: on-chain transaction hash
  - Amount: 1000
  - Source metadata: status "authoritative", as-of timestamp, version
  - Evidence hash: SHA-256 of chain transaction proof

**Assertions:**
- Data Fabric compares expected 1000 vs observed 1000
- Reconciliation status: "matched"
- Coverage: 1.0 (all required sources present)
- Missing or unavailable sources result in "incomplete" status
- Amount mismatch results in "mismatch" status with difference recorded

**Pass criteria:** Matched reconciliation when amounts agree; mismatch/incomplete when they don't.

---

## Test Vector 13: Privacy payload rejection

**Requirement:** Data Fabric rejects events with forbidden payload content.

**Setup:**
- Product creates event with payload containing:
  ```json
  {"userPrivateKey": "BEGIN PRIVATE KEY-----..."}
  ```

**Action:**
- Product submits event

**Assertions:**
- Data Fabric returns HTTP 400 Bad Request
- Response indicates forbidden payload field
- Event is not stored
- Same rejection for: seed phrases, passwords, PAN/CVV, raw mail/social content

**Pass criteria:** Private keys and sensitive content are rejected.

---

## Test Vector 14: Broker outage and reconnect recovery

**Requirement:** Product handles temporary broker unavailability.

**Setup:**
- Data Fabric successfully commits events to Outbox
- Broker (NATS) becomes unavailable

**Action:**
- Dispatcher attempts to publish pending Outbox records
- Publish fails with connection error
- Broker comes back online
- Dispatcher retries

**Assertions:**
- Failed attempts are recorded with retry count and backoff
- Events remain in Outbox with PublishedAt = zero
- After reconnect, all pending events are published
- Consumers receive all events in order (per partition key)
- No events are lost

**Pass criteria:** Temporary broker outage does not lose events; all are published after recovery.

---

## Test Vector 15: Consumer crash before acknowledgment

**Requirement:** Consumer handles crash before acknowledging delivery.

**Setup:**
- Event is delivered to consumer
- Consumer begins processing

**Action:**
- Consumer process crashes before committing Inbox and acknowledging message
- Consumer restarts
- Broker redelivers the same event (unacknowledged)

**Assertions:**
- Consumer Inbox has no marker for this event ID
- Consumer reprocesses and commits business effect + Inbox
- Consumer acknowledges message
- Final state is correct (no lost or duplicate effects)

**Pass criteria:** Crash before ack results in redelivery and correct final state.

---

## Test Vector 16: Canonical authorization binding

**Requirement:** Product uses canonical credentials with method/path/body binding.

**Setup:**
- Product obtains Wallet session with device signature
- Product constructs request: POST /v1/events with JSON body

**Action:**
- Product computes SHA-256 of exact body bytes
- Product includes in signature binding: version, session, device, product, bundle, request ID, nonce, timestamp, method, path, body digest, scope
- Product sends request with signature headers

**Assertions:**
- Data Fabric calls introspection endpoint with canonical request
- Gateway validates signature covers all bindings
- Gateway consumes nonce for session/device domain
- Gateway returns `active: true, requestBound: true`
- Data Fabric accepts request
- Tampered body or missing binding results in 401 Unauthorized

**Pass criteria:** Signature binding prevents replay and tampering; unbounded request is rejected.

---

## Test Vector 17: Stale request rejection

**Requirement:** Data Fabric rejects requests with timestamps outside freshness window.

**Setup:**
- Product creates request with timestamp older than 2 minutes

**Action:**
- Product submits request

**Assertions:**
- Data Fabric returns HTTP 401 Unauthorized
- Response indicates stale timestamp
- Request is not processed

**Pass criteria:** Requests older than 2 minutes or more than 30 seconds in future are rejected.

---

## Test Vector 18: Analytics pseudonymization and suppression

**Requirement:** Analytics projections are payload-free, pseudonymous, and respect erasure.

**Setup:**
- Event with account ID `account.user.0001` is appended
- User requests data erasure
- Erasure record is committed with HMAC of account ID

**Action:**
- Analytics replay runs after erasure
- Projection encounters event with `account.user.0001`

**Assertions:**
- Analytics sink receives event without raw payload
- Account ID is pseudonymized with HMAC
- Suppression check detects erasure record
- Event is skipped (not written to analytics)
- Existing analytics facts for this user are deleted
- Redelivery remains suppressed

**Pass criteria:** Erased subject's events do not enter analytics after erasure request.

---

## Test Vector 19: Retention class enforcement

**Requirement:** Events declare retention class and Data Fabric enforces it.

**Setup:**
- Product submits event with `retentionClass: "operational"`

**Action:**
- Data Fabric stores event with retention metadata
- Retention policy job queries events by retention class
- Operational events eligible for deletion after retention period

**Assertions:**
- Retention class is validated at append time
- Events can be queried by retention class
- Deletion respects financial/audit/legal-hold retention
- Deleted events leave audit tombstones

**Pass criteria:** Retention class is stored and queryable; enforcement is testable.

---

## Test Vector 20: Rate limiting per canonical session

**Requirement:** Data Fabric enforces per-session rate limits.

**Setup:**
- Rate limit: 120 requests per minute per session
- Product uses session `session.wallet.0001`

**Action:**
- Product sends 121 requests within 60 seconds

**Assertions:**
- First 120 requests succeed (HTTP 202)
- 121st request returns HTTP 429 Too Many Requests
- Response includes Retry-After header
- Different session is not affected

**Pass criteria:** Rate limit is enforced per canonical session.

---

## Integration Evidence Package

Product owners must provide:
- Source commit and release for producer/consumer adapters
- Event IDs and Inbox effect receipts from test vectors
- Saga success and compensation audit IDs
- Journal entry IDs and balance verification results
- Reconciliation run IDs with authority evidence hashes
- Failure/replay/outage test logs
- Privacy export/erasure receipts for account-bound flows
- Deployed environment and public URL states using nine release booleans

Do not paste keys, credentials, or production secrets into integration evidence.
