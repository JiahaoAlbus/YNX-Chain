# Durable owner control capacity

The V3 service reserves permanent intent records for each admitted owner. The
default bounded tier is 256 owners with 32 records per owner (8,192 reserved
records); the existing snapshot parser retains its 10,000-record hard ceiling.
This is not a claim of production concurrency or unlimited lifetime usage.

Set `YNX_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY` to canonical JSON containing
exactly `maxOwners` and `intentsPerOwner`. Both are positive integers and their
product must not exceed 10,000. The daemon validates this before constructing
either state host. GET `/v2/product-sessions/capabilities`, with a valid
`x-request-id`, returns only the non-sensitive configured limits and scope.

An owner with a persisted session, issued challenge, account cutoff, device
cutoff or committed intent has reserved slots. New challenge issuance and first
batch logout enforce the same owner admission boundary after signature checks.
One owner's new intents cannot consume another admitted owner's allocation.
Free newly generated keys do not bypass the maximum admitted owner count.
Existing owners retain their history if a tier is lowered; new owner admission
stops when reservations no longer fit. Admission is not Sybil resistance: the
current deployment has no external registration identity or paid admission.

Existing request and receipt fields and snapshot version 3 are unchanged.
Exact committed-intent lookup precedes intent quota/expiry checks. Old receipts,
replay records and account/device cutoffs are never evicted. Zero-session logout
still persists its cutoff, because an older approval may not have reached Auth.
New intents at an owner's limit fail with `CONTROL_OWNER_CAPACITY`; new owners
at the admission boundary fail with `CONTROL_OWNER_ADMISSION`. Individual
session inventory/revocation remains available under its existing proof policy.

Before stopping the public service, run the read-only inspection CLI against
the latest V2 state with the intended policy. It prints a digest, counts and
reservation status without returning accounts, sessions or secrets. Repeat
after stopping under the shared writer lock. Do not activate an over-reserved
migration, delete prior records to fit a policy, or silently create empty state.

Remaining limits are explicit: this service still uses a 32 MiB shared snapshot,
the pre-existing short-lived replay budget, synchronous full-snapshot writes,
and permanent receipts. Record reservation does not reserve arbitrary receipt
byte sizes or guarantee storage/CPU/network capacity. A durable receipt ACK and
retention protocol, scalable account-partitioned data layer, admission policy
and measured production load remain future work. Reaching these bounds must
not be reported as successful revocation, or corrected by restoring old state.
