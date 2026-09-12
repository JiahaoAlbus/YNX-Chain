# V2 create/save candidate

This extends the read candidate. It is not a complete Docs merge or deployment.

- POST /api/v1/objects uses the existing CreateObjectRequest JSON and response.
- PUT /api/v1/objects/{id}/document uses {baseVersion,content}; content retains the existing base64 JSON encoding of Go []byte.
- Docs requires ordered scopes ["docs.write","files.write"].
- Cloud requires ["files.write"].
- Each attempt requires a new v2 proof and one Idempotency-Key header, 16-128 ASCII letters, digits, underscores or hyphens. UUID keys are supported.
- Existing version-conflict responses remain 409 with current object metadata.

The frozen 9840 registry inspected during implementation has read-only Cloud/Docs
allowlists. The new write allowlists have been requested from the Wallet owner;
until registered, approved and deployed they cannot authorize real writes. Never
reuse a read proof for a write or claim a scope check is an exact business signature.

The journal is <StatePath>.v2-idempotency, private mode 0700, alongside schema7
state rather than embedded in its schema. Preserve it with the object/state backup
and rollback set. Do not delete it to recover a failed request. It contains body
digests and response receipts, not proof headers or the submitted document body.
It is local single-service storage, not replicated or an atomic multi-file database.

Authorization and resource checks run before receipt replay. Completed retries
with the same account/product/key and exact method, URI, Content-Type and body
return the saved status/body with Idempotency-Replayed:true. A different request
using that key gets 409 IDEMPOTENCY_KEY_CONFLICT. New sessions may retry the same
key only after fresh authority authorization; authorization is never cached.

A pending receipt is fsynced before the handler executes. A crash or failed
persistence acknowledgment can leave it pending. Such retries get 409
WRITE_OUTCOME_UNCERTAIN and must reconcile the actual object/version before any
new write; the service does not automatically execute that key again. This avoids
duplicate writes but is not an exactly-once atomic commit claim. Automatic
reconciliation and journal retention/compaction are not yet implemented.

Other v2 mutations remain 403 V2_ROUTE_NOT_ENABLED. Missing key is 400
IDEMPOTENCY_KEY_REQUIRED; oversized body is 413 WRITE_BODY_TOO_LARGE; journal I/O
failure is 503 WRITE_JOURNAL_UNAVAILABLE or WRITE_OUTCOME_UNCERTAIN. The initial
business 5xx is returned without marking the receipt complete. Do not blindly retry
with a different key. Existing drafts must survive these errors.

Local tests cover journal restart replay, body conflict, stored version conflict,
uncertain-result blocking and the v2 read/auth boundaries. This is not evidence of
a public signed create/read/save round trip, full state cold-load compatibility,
or completed backup/observability/Docs feature merge.
