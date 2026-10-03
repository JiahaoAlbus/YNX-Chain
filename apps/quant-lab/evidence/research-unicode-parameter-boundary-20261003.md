# Research parameter duplicate boundary

Reviewed predecessor: `5c3d88e99120d4dc9a01dd89e992fb6845241197`.

The research HTTP decoder used ASCII-style lowercasing for duplicate detection,
but Go's JSON struct decoder accepts Unicode simple-fold aliases. A request with
both Seed and ſeed passed the duplicate check and returned 201 with a completed
calculation. This was reproduced through the existing public research HTTP
handler before changing the decoder. It is a local fixture, not a public trade.

Reuse the existing pure key canonicalization helper for research and market JSON.
Do not introduce another decoder/protocol. The HTTP regression covers duplicate
Seed/ſeed and SlippageBPS/ſlippageBPS, requires 400 invalid_research_parameters
with errorId, no market call and unchanged durable state bytes. Existing omitted
parameter defaults remain valid, public calculations remain stateless, and
persisted historical strategy unmarshalling is unchanged.

Validation: full Quant and actual server race tests, vet and diff checks. Real
public integration, user approval, private identity, signing, execution and
independent QA PostgreSQL concurrency remain separate, unproven gates.

Actual results: race PASS internal 2.854s / server 1.385s; vet PASS; diff PASS.
The failing pre-fix request returned 201 instead of the expected 400. After the
fix, both added Unicode cases reject before reading the market; all original
invalid cases and the positive omitted-default case pass unchanged.

No shared authority, schema or public runtime mutation. Source rollback uses a
normal reviewed revert of this owner checkpoint; publication remains with A.
