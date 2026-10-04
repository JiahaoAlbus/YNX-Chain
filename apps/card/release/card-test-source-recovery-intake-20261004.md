# Card TEST source recovery intake

Owner branch: codex/card-test-service-recovery-20261002. Base: 2e55042b32622b8c5bfd92b0d79d9fd8d455f6f7.

## Direct public readback

On 2026-10-04 the canonical Card version endpoint returned backend e95fcf443228d0db97c139dfa5e8ad6fbb7aa675, simulation environment, configurationReady=true, runtimeFundingVerified=false and productionRealPayments=false. The canonical runtime identity returned frontend 66126513738ecbd77a372d2ab7f5ac34076c2208/tree18e8c7c32f887d0bc34bd2c6182e7e7199b909fd and an explicit compatibility declaration binding that frontend to e95fcf. This is a declared public pair, not proof that an older cached JS consumer matches it or a private approval succeeds.

## Implemented consumer changes

- Keep the exact accepted backend, compiled frontend/tree, chain and compatibility checks; no accepted tuple or scope change.
- Report identity disagreement as CARD_API_SOURCE_MISMATCH with a safe boundary stage: backend identity, frontend identity, or source binding. Only static error codes/stages are exposed, never arbitrary remote error text or identity secrets.
- Treat unavailable HTTP, wrong content type, malformed/non-object/oversized JSON and network failure as CARD_API_SOURCE_UNAVAILABLE. No private client or introspection approval is created following a failed version check.
- Existing English private-service error presentation now explains reload/retry without clearing application records or requesting another Wallet approval. The Standard Wallet and guest layer are explicitly independent.
- No storage wipe, automatic application replay, automatic authorization, service-worker purge, or source fallback is introduced.

## Regression

npm test: 289 + 39 + 23 + 11 = 362 passed, zero failures/skips. npm run typecheck: frontend and separate server projects passed. Logs are preserved under evidence/20261003-testnet-operations/card-source-recovery-*.

These controlled source gates do not prove a new public deployment, real account access, Card authorization, signature, backend activation, YNXT transaction/credit or completed Testnet journey.

## Sole release owner handoff

The accepted source-compatibility file is unchanged. Admit the resulting exact source/tree using the existing reviewed build/runtime identity pipeline and separately bind any new backend operation tuple before formal release. Do not relabel a newer backend as e95fcf or relax frontend/tree checks. After publication, reproduce the actual source mismatch/recovery UI against the exact delivered page assets, then verify user-approved TEST application persistence and the actual backend receipt. Formal Host, shared Wallet/Auth and public API changes remain solely with A.

The existing MetaMask request remains pending for the human; do not repeat or bypass it. Real issuing, PAN/CVV, fiat, real payment/settlement, AICardAPI and Live remain excluded.
