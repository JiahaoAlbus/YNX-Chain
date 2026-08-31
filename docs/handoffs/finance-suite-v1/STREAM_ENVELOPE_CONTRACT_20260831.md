# Finance suite source-stream envelope v1 handoff

Status: Finance-suite source contract only. It is not centrally integrated, deployed, or evidence of a live financial stream.

## Scope

`release/integration/finance-source-stream-envelope-v1.schema.json` defines the product-owned JSON shape for an SSE or WebSocket message that carries a source-bound Finance domain record. It is deliberately narrower than a trading protocol:

- only `snapshot`, `upsert`, and `reconciled` events are valid;
- `eventId`, `requestId`, a monotonic non-negative `sequence`, and `emittedAt` make resumption and correlation possible;
- `readOnly: true` is mandatory and no action capability exists;
- the data kind is one of the eleven `ynx-finance-domain-v1` models;
- `sourceStatus` must equal `data.source.status` in the runtime validator;
- cursor values are opaque product-owned identifiers.

The JSON Schema validates the transport shape. `packages/finance-domain.validateStreamEnvelope` remains the cross-field authority for model provenance and status matching.

## Integration boundary

Integration may map this envelope to a separately accepted Data Fabric event envelope. That mapping must not add a mutation grant, Wallet authorization, order submission, strategy lifecycle action, or asset transfer. Products must use their own endpoint and reconnection policy and preserve the underlying `requestId` for tracing.

## Evidence and outstanding gates

Local package tests cover valid and fail-closed stream envelopes plus version locking between the schema and runtime validator. No public SSE/WebSocket endpoint, wallet session, provider approval, account, signature, transaction, installation, or ComputerControl proof is claimed by this handoff. A product-specific path lease, source-bound runtime, and direct visible evidence remain required before any public-stream claim.
