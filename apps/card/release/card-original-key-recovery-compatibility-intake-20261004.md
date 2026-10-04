# Card original-key recovery availability: matching backend intake

Base owner source: 2e5355a2c26d64e8fa479870a15826b7ff7e11cb/tree7844b83e814b318dd1233f1592a4b051d4fada0b.
Branch: codex/card-test-service-recovery-20261002.

## Independently verified upstream preparation

A's HANDOFF was read from card-original-2e535-source-build-preparation-20261004 in the original coordination folder. A prepared the exact source and unmodified Web build offline in an isolated sparse checkout, with 674 tracked source blobs and 13 public assets; build exit0, QA/nonformal. Its receipt SHA is f27977a2a67312bf5414a93ae1d68302b524960e0f8c92bb98b82ed2a1f16e26 as supplied by A. No public delivery or complete backend acceptance is inferred.

A confirmed the public e95 backend lacks the newer GET original-operation-result route. The existing fixed 7f9/e95 compatibility file is unchanged by this repair.

## Implemented safe compatibility

- Card's newer server version endpoint declares features.operationReadback = ynx.card.original-key-readback.v1 because that owned server source implements GET /api/card/v1/operations/:kind/:resourceId/:key/:digest with the existing authenticated account-read permission, owner, digest and original idempotency-slot checks.
- This marker is availability metadata only, not a Wallet/Session permission, approved account, backend activation or funding receipt. Version schema and scopes are unchanged. configurationReady, runtimeFundingVerified and productionRealPayments retain their independent meaning.
- The runtime factory first validates the exact accepted frontend/tree/backend pair, then carries the exact feature marker into the actual CardBusinessClient. Absence, malformed markers or an unvalidated source do not imply recovery support.
- Existing application/state/statement readers remain usable subject to their existing private identity/proof gates. The operations UI disables new mutations, original-result queries and unknown-outcome retries when the exact marker is missing. Existing statement events remain visible. Pending journals are loaded and preserved, never reset, rewritten or retried automatically.
- Localized availability feedback explicitly says not to resend with a new key. Guest and Standard Wallet remain separate.
- Direct API authentication remains authoritative. The marker never grants a scope and is not a replacement for signed proofs or source admission.

## Matching release action for sole A

Do not backfill a marker on an unchanged e95 deployment or relabel a newer server as e95. Deliver an actual successor backend with this route and source identity, preserve the encrypted original store/keys/account records, and admit its exact compatibility tuple. Until that exists, deliver the guarded consumer with truthful read-only modern operations. The already-prepared 2e535 QA assets are not claimed to contain this successor guard. Rebuild only from the resulting admitted exact source, through the original source identity pipeline; do not weaken SOURCE_MISMATCH or invent permission scopes.

## Executed batch

npm test: 300 + 39 + 32 + 11 = 382 passed. Backend: 119 passed, including real local HTTP version readback against the original server implementation, with no configured Wallet/Core authority. Total 501 passed, zero failures/skips. Frontend and separate server typecheck passed after the new HTTP test explicitly narrowed its unknown JSON object. Original failed typecheck log is retained; no any-based bypass.

Controlled gates prove disabled old-backend UI, exact runtime feature propagation, rejected wrong source, and byte-for-byte preservation of unknown requests without API calls. They do not prove a public matching release or a user-approved transaction.

Public Host remains A's unresolved execution gate. No formal deploy, private grant, MetaMask request, signature, transaction, Card activation or funding credit is executed or claimed here. No Live, real issuing, PAN/CVV, fiat, real payments or AICardAPI is introduced.
