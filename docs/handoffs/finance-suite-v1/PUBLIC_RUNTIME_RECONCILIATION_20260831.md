# Finance-suite public runtime reconciliation — 2026-08-31

## Read-only sample

At `2026-08-31T13:16:22Z`, one bounded HTTPS read of each product's advertised health and version route produced the following results. The captured response bodies are retained only in local evidence directory `/tmp/ynx-finance-suite-public-readback.UQV8IA`; this handoff records their bytes and digests so Central can independently repeat the sample. No account request, signature, transaction, deployment, configuration change, or server write occurred.

| Product | Route | HTTP / MIME | Bytes / SHA-256 | Interpretation |
| --- | --- | --- | --- | --- |
| Finance | `/health` | 200 / JSON | 485 / `d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1` | Old runtime reports `3b2383f5…`, file-CAS single-host state and `multiInstanceState:false`. |
| Finance | `/version` | 200 / JSON | 130 / `39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226` | Old release `ynx-finance-3b2383f5c18a`; not a current candidate binding. |
| Exchange | `/health` | 200 / HTML | 18,603 / `64c5b7862099eb06a316fbc6d1c665e81355f427fa27b26584bbf586ac4eacde` | Route falls back to the web document, not a machine-readable health receipt. |
| Exchange | `/version` | 200 / HTML | 18,603 / `64c5b7862099eb06a316fbc6d1c665e81355f427fa27b26584bbf586ac4eacde` | Same fallback; no source/runtime identity is available. |
| DEX | `/health` | 200 / JSON | 238 / `20a96d0ac7dede526b2b37bea77dccc430b9d3cf32372fd2b038e733c38567a3` | Runtime reports indexed Testnet state, but not the current source candidate. |
| DEX | `/version` | 200 / JSON | 126 / `da7de848ab2f74dfdb15b0f00f11dbba9b7cf95223abd7137d21ea9d35433296` | Commit `ac775de24176b293b5dbb5ab7114cf29428f8046`, not `e752a9cc…`. |
| Quant | `/health` | 404 / text | 19 / `b16e15764b8bc06c5c3f9f19bc8b99fa48e7894aa5a6ccdad65da49bbf564793` | No public health contract is mounted at this URL. |
| Quant | `/version` | 404 / text | 19 / `b16e15764b8bc06c5c3f9f19bc8b99fa48e7894aa5a6ccdad65da49bbf564793` | No public version/source binding exists at this URL. |

## Candidate reconciliation

| Product | Current owner source / tree | Public state at sample | Required action before a release claim |
| --- | --- | --- | --- |
| DEX | `e752a9cc190fcbd5e4bd7f3799dc9b2645a1154f` / `5cb826f278b617f7d3ba7e79ad0fad249251eb2d` | Public commit differs. | Central must first bind the four shared release records to e752, then issue a DEX-only rollback-first deployment lease. |
| Exchange | `1b263be6ed29341046f78657f6587afa13f3b629` / `c9fed17d8eab3955f18e9af1a74b250d9e3a71b0` | Health and version are HTML fallbacks. | Bind non-fallback API routes plus current runtime/rollback and PostgreSQL readiness, then issue an Exchange-only lease. |
| Finance | Candidate is controlled on the separate P0-298 correction branch. | Public source is old `3b2383f5…` and single-host. | Do not deploy from this branch. Central must use the independently completed successor and fresh rollback-first mapping. |
| Quant | `301b680ac8bec297108a75920b1c34354345b574` / `9bf449bb52d8d2d1a3c6222da4f4891f7f22e9e0` | Expected routes are absent. | Bind host/service/database/rollback plus non-fallback routes, then issue a Quant-only lease for the frozen 301 archive. |

This is a negative reconciliation record, not an availability claim. It proves no current source-bound public runtime, Wallet approval/rejection, callback, Product Session lifecycle, installed package, order, swap, liquidity operation, strategy execution, signing, or Testnet transaction for any product.

