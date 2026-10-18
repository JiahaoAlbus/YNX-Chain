# Same original account-policy parser: v2 owner projection (development)

Owned source: src/pq-wallet-policy.js; current counterexamples: test/pq-wallet-policy-v2.test.mjs. Frozen SDK3.6/R28 and deployed operator configuration are unchanged.

parsePQAccountAuthorization(value, expected) keeps the existing v1 minimal core exactly. A terminal-revoked owner has the same core with policyVersion='YNX-ACCOUNT-POLICY/v2' and REQUIRED revocations array with exactly one owner-only record:

{owner, authorizingRevision, throughRevision, registeredAt, revokedFrom, ledgerNonce}

owner is the exact original canonical owner. The other FIVE fields (not six decimal fields) are exact unsigned decimal strings. The six keys comprise one owner plus five decimal fields. Do not convert through Number. authorizingRevision is the lawful active registered revision at registeredAt. throughRevision is the latest full retained revision. registeredAt>=enableAt and <=observed next executionHeight; revokedFrom=registeredAt+1 without overflow. revoked ledgerNonce is greater than every prior retained registration's ledgerNonce and <=observed ledgerNonce. No registration may be after terminal registration. V2 requires an actual terminal tombstone; v1 core has no revocations key. Complete ordered records/full keys remain retained.

Source must validate the actual RPC's additive metadata, current health/checkpoint, exact committed/next height and independently derived statuses. For an unaffected owner under global v2, only after validating empty owner revocations and all matching statuses may Source preserve the unchanged v1 owner core. Never discard a nonempty tombstone. Do not feed the full RPC DTO into a minimal core parser or turn its public fields into authority.

New DATA helper inspectPQAuthorizationView(snapshot, atHeight=snapshot.executionHeight) derives {authorizationStatus,pqSigningEnabled,activeRecord,executionHeight}. atHeight must not exceed the observed next height; records/tombstone registered after atHeight are ignored for that historical view. It is DATA only, not an independently authenticated checkpoint or grant. Source can compare actual next and committed status fields using this one existing parser's retained full history.

Status values: legacy, pending_activation, active, revocation_pending, revoked. Pending revocation can still sign one lawful current-height transfer. It cannot create any new migration after its tombstone has been admitted. At revokedFrom onward inspectPQWalletActionPolicy refuses every action with PQ_ACCOUNT_REVOKED; no classic/recovery/new-key fallback. Pending migration attempt after terminal registration gives PQ_TERMINAL_REVOCATION_PENDING. Invalid tombstone uses PQ_POLICY_REVOCATION_INVALID; invalid historical view uses PQ_POLICY_VIEW_HEIGHT_INVALID. Existing schema/record/current errors remain.

assertPQAuthorizationCurrent must reject crossing revokedFrom even if activeRevision/full keys/nonce/serialized record list are unchanged. classifyPQRegistration returns revocation_pending/revoked for retained matching historical migrations, never active or retryAuthorized:true for a tombstoned owner.

This is executable source development, not a formal package or Source qualification. Auth owns actual operator input/committed metadata/lifecycle and release selection. SDK owns only the existing parser/planner. No public write is performed.
