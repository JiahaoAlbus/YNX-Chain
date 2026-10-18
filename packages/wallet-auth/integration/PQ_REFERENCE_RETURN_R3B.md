# Original Auth reference return and recovery

SDK version: `1.3.0-pq.3.2`. This is an additive candidate over R3a, not an installed-client or Source-admission claim.

## Existing authority and transport

The original `ProductSessionGatewayNodeHost` persists full canonical request, V3 approval, original issued P256 challenge and exact completion inside its existing atomic snapshot under the optional `returnPublications` namespace (`YNX-PRODUCT-SESSION-RETURNS/v1`). The original Authority alone issues/completes the session and consumes the nonce. There is no independent database, issuer or callback approval engine.

The four fixed normal HTTP paths are `/v2/product-sessions/returns`, `/returns/challenge`, `/returns/complete`, `/returns/outcome` under `/v2/product-sessions`. Their JS callers on the existing `ProductSessionGatewayFetchAdapter` are `publishReturn`, `returnChallenge`, `completeReturn`, `returnOutcome`. The configured, registered normal HTTPS authority must be selected by the original service bootstrap, not an authorization URL or renderer. Its existing request/response parser, timeout, no-store policy and redirect refusal remain in use.

The original NodeHost main-only counterparts are `publishOriginalProductSessionReturn`, `readOriginalProductSessionReturnChallenge`, `completeOriginalProductSessionReturn`, `readOriginalProductSessionReturnCompletionOutcome`. They return the existing HTTP response envelope and enter the same policy and persistence transaction. `readOriginalProductSessionReturnOutcome(requestId)` is an owning-process metadata read after a lost publish response; it is not an HTTP route or permission to retry. A remote publisher without this owning-service callee remains unintegrated.

Native R16 private transport still has only beginYNX/handleReturn/restore/disconnect. All four reference methods on `ProductSessionGatewayPrivateAdapter` explicitly refuse as unsupported. No Native budget, qualification frame, operation meaning or protected Source requirement changes.

## Source port

Reference routes add exactly one ninth operation field, `publication`. Publishing uses null. Other routes use a frozen projection of the original snapshot row: `{requestRaw, approvalRaw, completed}`; `session` is null for pending and the actual Authority stored session for completed. The projection is a locator, never authority. Source is freshly borrowed before execution, rechecked afterward and closed through its original lifecycle. A changed snapshot while awaiting Source is refused. Old routes retain exactly eight fields.

The matching original Auth supplier is R25: `host-reference-source-r25-20261018/HANDOFF.json`, SHA256 `1c78db2610524ef06b7492de352daafea0090a2806ddbf9f75ccd432cbeb6430`. Its five exact source leaves and original factory are a separate owned supply; this SDK does not substitute fixture producers or silently mount an ambient Source factory. R26 independently exercised that real factory with this Host under actual R24, with explicitly mocked producer HTTPS and QA keys. Those controls do not establish real Source qualification.

## Small callback and original client

Publishing takes `{requestId,request,approval}` and returns `{reference,nonce,state,expiresAt}`. `createProductSessionReferenceReturnURL` encodes exactly result/reference/nonce/state, at most 4096 characters. It is explicitly unverified locator data; normal approval parsing does not turn it into a grant. The complete dual signature remains in the original server snapshot.

The existing RecoverableProductSessionClient uses the fixed normal HTTP adapter to fetch and bind the original challenge, obtain fresh authority time, persist an unsigned signing-intent marker, sign once with the existing device, save the exact result, and complete once. The versioned protected completion is at most 16KiB. A device signing UNKNOWN marker survives cold recovery and cannot cause a replacement signature. A saved signed completion can only query outcome, then introspect the exact actual session; pending/not_found never authorizes resubmission. Wrong device, request, callback, nonce, state, scope, expiry or session binding refuses. Begin/network/revocation lifecycle guards remain active across awaits.

Legacy storage budgets, V2 callback parsing and normal response/Source/Native budgets remain unchanged. Full V3 completion recovery uses a separate non-serialized, completion-only capability against fresh same-revision Source and historical signed challenge bytes; it cannot authorize a new challenge or approval issuance. The real terminal journal hashes all six private V3 carrier fields, including the marker, while preserving the legacy five-field digest.

## Truth and release gates

The snapshot retains at most 64 publication rows and fails closed at capacity. There is no garbage collection that discards unknown or historical originals. This bounded candidate needs an approved retention/capacity decision before public multi-user release.

App's existing sender still needs a formally supplied, identity-bound normal-service publisher at its original Controller.publisher integration point. A generic renderer/baseURL-selected HTTP writer is not supplied by this change. The small callback's actual OS/browser delivery and matching installed App must be verified after that owner connects the formal callee. No fallback to the oversized approval URL is authorized.

IDE SDK20/r6a parent admission is unchanged. Independent admitted release-row/root/signature-purpose/frame/issuer bindings and matching protected enrollment/profile/head/current installation have not been newly delivered. R25, R26, the SDK candidate and the compiled R16 component do not replace them. Public deployment, protected installation, Native grant and real user acceptance remain open.
