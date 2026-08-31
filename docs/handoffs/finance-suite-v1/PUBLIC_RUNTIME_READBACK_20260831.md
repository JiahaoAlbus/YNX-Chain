# Finance-suite public runtime readback — 2026-08-31

This is a read-only network receipt for deployment planning. It is not a
source-bound release verification and does not authorize a deployment.

## Candidate branches awaiting independent deployment leases

| Product | Owner branch / candidate checkpoint |
| --- | --- |
| Finance | `codex/final-finance-suite` / `01f78dbd126d750a8fa948875bc88aa7275c00fc` |
| Exchange | `codex/exchange-a9-runtime-carrier-20260831` / `7f4395f84ccd730bc520ed9b297e7c3956b9d341` |
| DEX | `codex/dex-c7-four-path-manifest-20260831` / `e752a9cc190fcbd5e4bd7f3799dc9b2645a1154f` |
| Quant | `codex/quant-owner-contract-snapshot` / `7aeea017e27dd9c9614083205655a9aa49ce32ba` |

## Direct HTTPS readback

Responses were fetched without credentials, redirects were not followed, and
the response body was hashed with SHA-256.

| Product | Route | Result |
| --- | --- | --- |
| Finance | `/` | client timeout after 8 seconds |
| Finance | `/health` | `200`, 485 B, `d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1` |
| Finance | `/version` | `200`, 130 B, `39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226` |
| Exchange | `/`, `/health`, `/version` | each `200`, 18,603 B, HTML fallback, `64c5b7862099eb06a316fbc6d1c665e81355f427fa27b26584bbf586ac4eacde` |
| DEX | `/` | `200`, 931 B, HTML, `aead21e2f53dce3b6b08b964f2021283147e19f44f9591316b7bb7d130f0492a` |
| DEX | `/health` | `200`, 238 B, JSON, `20a96d0ac7dede526b2b37bea77dccc430b9d3cf32372fd2b038e733c38567a3` |
| DEX | `/version` | `200`, 126 B, JSON, `da7de848ab2f74dfdb15b0f00f11dbba9b7cf95223abd7137d21ea9d35433296` |
| Quant | `/` | `200`, 19,299 B, HTML, `7030c610e5830b3c69b831caa8bdd5ff5bc3559ac83d340db6d40a9914802763` |
| Quant | `/health`, `/version` | each `404`, 19 B, `b16e15764b8bc06c5c3f9f19bc8b99fa48e7894aa5a6ccdad65da49bbf564793` |

## Consequence

None of these responses proves that the public runtime uses the listed owner
source. In particular, Exchange has no product JSON boundary at its current
domain, Quant lacks health and version routes, Finance still exposes the old
health/version receipt, and DEX's JSON receipt has not been bound to its
current candidate. All `deployedPublic`, installed, provider-approval,
signature, order, trade, liquidity, and strategy-execution flags remain false.

Central should issue a separate rollback-first, single-use deployment lease
only after freshly binding each product's host, service, environment, state,
unit, Caddy/static-root, active release, rollback target, and public response
contracts. A lease for one product must not be used for another.
