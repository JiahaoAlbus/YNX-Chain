# Native terminal revocation HTTP contract R1

This source candidate adds `POST /accounts/{owner}/authorization/revoke` and explicit revocation metadata to account-policy queries. It requires the matching complete Devnet revocation/history/snapshot/Whole changes and a separately verified fixed commit. It is not enabled on the public testnet by the existence of this document. Wallet submission authority is separate.

The request is the canonical complete `ynxauth.Revocation.Encode()` binary, Content-Type `application/octet-stream`, maximum 131072 bytes. The intent binds the original genesis network, exact owner, both full currently lawful public keys, authorizingRevision, throughRevision, ledgerNonce, executeAt and revokeAt. RevokeAt must equal the exact next execution height plus one. The current pair signs the full intent using the ACCOUNT-REVOCATION purpose and N=1. No classic signature, new replacement key or alternate recovery branch participates.

This is terminal account-policy revocation: from revokedFrom onward both currently active and already-pending registered pairs lose authority. It retains all original registration history and never re-enables classic authentication or a future new-key-only migration. An ordinary key rotation is the separate migration path, authorized by the current pair plus fresh-pair possession proof.

The transaction identity is `0x` + lowercase SHA-256 of the complete original revocation wire. The native transaction has type account_revocation, From/To equal owner, amount 0, fee 1, and the exact signed ledgerNonce. Its complete original wire is retained in the authenticated native history memo. Fee provenance, account nonce/bandwidth, transaction and tombstone share the same durable mutation.

HTTP 200: `{transaction, wireHash, decimalFields, replayed, status, policyView:"next_execution", consensusFinality:false}`. Status is revocation_pending before its activation height or revoked afterward. The decimalFields values are all decimal strings: amount `"0"`, fee `"1"`, nonce, executionHeight (the signed executeAt), revokedFrom, authorizingRevision and throughRevision. Replaying the exact already-admitted wire returns the original transaction without another fee or nonce; it may reconcile local persistence.

An identical old migration replay still returns its original transaction, but its current policy status is revocation_pending or revoked when this owner's tombstone exists. It must not report active merely because the historical key record is retained. Consumers that recognize only the v1 migration status set must fail closed on these new states.

Wrong media type/oversized body/empty or malformed intent/mismatched route use the existing 415/413/400 `{error:string}` responses. Invalid authority, nonce, height or business state uses 422. An uncertain post-rename persistence acknowledgement uses the same 503 UNKNOWN envelope as PQ transfer/migration, retaining original transactionHash, wireHash and decimalFields. Error text is diagnostic, not a machine retry policy. No response authorizes automatic replay, new signing or nonce replacement after UNKNOWN.

GET `/txs/{originalHash}` uses the additive read-only native reconciliation DTO. For revocation, wireHash is the original hash and decimalFields also include the signed executeAt as executionHeight, revokedFrom and both revision boundaries. blockNumber remains separate: an execution intent height is not committed inclusion. The same memory_only/uncertain/pending_durable/durable local-snapshot statuses apply. Absence is only a current producer lookup, not proof of no effect.

GET `/accounts/{owner}/authorization` keeps algorithmVersion identifying the account's PQ policy even after revocation; it does not label revoked PQ accounts legacy. It adds:

- authorizationStatus and pqSigningEnabled for the next execution height;
- committedAuthorizationStatus and committedPQSigningEnabled for the actual committed height;
- revocations, the complete **owner-only** tombstone list with owner and decimal-string authorizingRevision, throughRevision, registeredAt, revokedFrom and ledgerNonce;
- globalPolicyVersion, the actual full-ledger version; policyVersion remains the owner projection's version.

Status values are legacy, pending_activation, active, revocation_pending and revoked. pqSigningEnabled is true only when this owner's registered pair is active at that view's height and is not yet revoked. revocation_pending can still have pqSigningEnabled true for its final lawful execution height. Committed status ignores tombstones not yet registered in a committed block; it also honors the separate revokedFrom height. Old and new views can legitimately differ.

After one owner's first revocation, the complete ledger is YNX-ACCOUNT-POLICY/v2. An unaffected owner's complete projection has no tombstone and retains v1 owner-policy semantics, with globalPolicyVersion exposing v2. This projection must never replace global state during persistence/import. A revoked owner's projection is v2 and contains its tombstone; a consumer without v2 support must refuse authority rather than ignoring that tombstone. recordsComplete still describes the requested owner's local complete history, not a consensus/non-omission proof. Existing checkpointStatus/integrity/source/next_execution-versus-committed boundaries remain unchanged.

Source: `internal/api/pq_revocation.go`, `pq_authorization.go`, `pq_reconciliation.go`, `server.go`; `internal/chain/pq_revocation.go`, `pq_authorization.go`, `pq_snapshot.go`, `pq_batch.go`; `internal/ynxauth/revocation.go`. Tests use temporary real-key ledgers and cover next/committed separation, no classic fallback, other-owner isolation, exact original UNKNOWN reconciliation, and restart. Only the matching remote execution result establishes that these tests passed.
