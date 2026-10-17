# Atomic Product Session revocation completion successor

Source candidate only. No Host execution, installed OS store, actual Wallet or public service assertion. The original Promise<void> finish port remains compatible and cannot prove this new capability.

## Consumer sequence

1. Preserve the application's original logout journal/target before invoking SDK disconnect. When the protected runtime offers the complete atomic port trio, the returned state includes `revocationCompletion`.
2. On cold start call `getRevocationCompletions()` in the **original** authority/product/platform/device/scopes/generation/account namespace. It performs no Auth request, new signing or grant renewal. Match the original session binding and target digest to the application's original journal. No session/null namespace migration.
3. Only after the application commits its own durable terminal record, call `acknowledgeRevocationCompletion(exactReceipt)`. Acknowledgement only removes the identical local record. Do not acknowledge before the consumer journal commit.
4. `getRevocationCompletion(originalIntentId)` is an exact lookup. Missing history is unknown, never revocation success. History is bounded at64 and never evicted implicitly; a full history rejects further cleanup while preserving the original intent.

## Native protected transaction ports

Provide all three together in existing `runtime.storage`, retaining the same expected-context enforcement as original ports:

- `finishRevocationIntentWithCompletion(namespace, originalRevokeKey, originalIntentRaw, completionRaw, expectedContext): Promise<string>`
- `getRevocationCompletions(namespace, originalStorageKey+":revoke-completions", expectedContext): Promise<string|null>`
- `acknowledgeRevocationCompletion(namespace, historyKey, exactReceiptRaw, expectedContext): Promise<void>`

The first MUST compare original intent bytes, validate exact target/result, preserve any newer session/request, consume original intent and associated negative-only signal, and insert immutable receipt **in one OS durable transaction**, returning only after that commit. No await between independently persisted cleanup and receipt; no software Map used as production durability. A crash after commit leaves a cold-readable receipt. Failure before commit leaves the intent and original protected state. A failure after commit must remain distinguishable through cold history and must not reissue business operations.

History canonical JSON is at most64 receipts/131072 code units. Native SDK checks exact binding/target readback and rejects lying or partial port sets; runtime itself must enforce atomic context and durability. This source cannot prove an arbitrary native port implementation. Capability `durableRevocationCompletion` accurately reports presence of that port contract, not OS verification. Legacy ports cause the new history API to throw DURABLE_REVOCATION_COMPLETION_UNSUPPORTED.

Browser storage performs cleanup and receipt append in the existing single IDB readwrite transaction; the original nonextractable key namespace is retained. Negative signal cleanup happens after IDB commit, so its failure cannot erase the receipt. Actual browser IDB/OS tests remain required; current source tests run the exact handlers with a controlled transaction-abort model.

## Receipt schema and authority meaning

Canonical exact fields `{version:1,intentId,scope,targetDigest,sessionBinding,outcome}`. Scope digest binds original chain/product/client/platform/app/bundle/package/origin/callback/device key/id/scopes. Target digest binds the complete original parsed ProductSession using YNX_PRODUCT_SESSION_REVOKED_TARGET_V1. No secret, token or raw session is retained in the receipt.

`server-revoked` is selected only after the original Gateway confirms the exact revocation or authenticated SESSION_REVOKED response. `authority-expired` is selected only by the original authenticated authority time; it never claims server revocation. `local-only` requires no session target and never proves remote revocation. No receipt is a new server signature or renewed grant. Its provenance is the protected SDK transaction after the existing authority decision.

## Validation / preserved failures

17 related targets PASS, strict existing typecheck0. New5 targets cover commit-before-return crash/cold recovery, forged acknowledgement, lying ports, old capability/context fencing, local-only false remote flag, exact Browser handler transaction abort/full-history/newer-session preservation. Existing five-platform source HTTP/P256 fixture tests and original signal tests remain software/controlled evidence only. Three preparatory QA failures (duplicate copied helper imports twice; missing VM security constant) were repaired in the test harness without altering runtime guards and remain in owner receipt. No whole release/build/public gate is elevated.
