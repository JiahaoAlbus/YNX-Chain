# Finance domain provenance contract gap — Central decision request

## Purpose

Fable5 requires finance facts to expose `source`, `asOf`, `version`, and, when applicable, `confidence` and `coverage`. This is a source-only compatibility request; it grants no product write, Wallet scope, deployment, or transaction authority.

## Exact reviewed state

Review head: `c5cac90d82d3930ec553d325c6c2b41ca25863a2`.

| Object | Git blob | Bytes | SHA-256 | Finding |
| --- | --- | ---: | --- | --- |
| `packages/finance-domain/src/index.js` | `3f578c93233abf07166b7bf385d216d1cab1a6d8` | 20,696 | `96a11875be327e7587a6b513e992841b183c942fb2e659662bd1e4352b1bc15b` | `validateSource` validates `owner`, `system`, `version`, `asOf`, `classification`, and `status`, but not `confidence` or `coverage` (lines 112–120). |
| `packages/finance-domain/src/index.d.ts` | `02b3d26363bcf9e0615ae92e2366feb2dc141071` | 3,869 | `5c965e8775a6662d88fa1375828c9325bc11f59f2f3c4c17b0a7fb9e7c2d9fbe` | Declares optional `confidence?: string` and `coverage?: string` (lines 19–20), without a canonical value domain. |
| `release/integration/finance-suite-domain-contract-v1.json` | `73c942932ff2b4bece5c7ac7c858a701a3a905d6` | 3,017 | `f0655d9353bb4eca02a6f619b764e23d2c7b8eb257520f0fa4ebecf880eca55a` | `sourceProtocol.required` omits both fields and provides no conditional applicability rule (lines 20–24). |

Focused validator evidence: `cd packages/finance-domain && npm test` passed 12/12 on this review head. The green result proves current behavior only; it does **not** prove Fable5 provenance completeness.

## Required Central decision

`29-integration` must freeze one backwards-compatible successor to `ynx-finance-domain-v1` before consumers encode these fields. The decision must define:

1. The canonical value shape and allowed values/range for `source.confidence` and `source.coverage`.
2. The exact applicability rule (for example, which reference, estimated, partial, aggregated, Oracle-derived, or stale facts must include them).
3. Whether absent fields mean "not applicable" only, never an unstated unknown value.
4. The matching JSON Schema, TypeScript declaration, JS runtime validation, Go `DomainSource` mapping, and positive/negative vectors.
5. The version, old-client compatibility, migration/rollback rule, and Data Fabric/Oracle consumer mapping.

## Safe successor scope after acceptance

The finance-suite owner can then make one path-scoped candidate change limited to:

- `packages/finance-domain/**`
- `internal/finance/domain.go`
- `release/integration/finance-suite-domain-contract-v1.json`
- matching source, integration, and cross-product test vectors

No product page, shared Wallet protocol, global registry, deployment configuration, credentials, signing, account approval, or financial execution is included. Until the Central version is accepted, producers must continue to use the existing six required provenance fields and must not invent a confidence or coverage vocabulary.
