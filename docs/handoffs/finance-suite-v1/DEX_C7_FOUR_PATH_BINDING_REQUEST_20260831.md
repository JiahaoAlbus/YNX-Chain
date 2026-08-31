# DEX C7 coherent source-binding request — 2026-08-31

## Decision input

The Central C7 decision is `DEX_C7_SHARED_BINDING_IS_NOT_ROOT_FILE_ONLY_AND_REQUIRED_COHERENT_MANIFEST_SET_NOT_FROZEN`.
The Web/wallet candidate is `c7a96d48f17f9dc70bbdc42389cf1052771ee904`
(tree `85b8d018ee8541cc560b0865fb5f3cc0acfa2767`).  Its four release metadata
files still bind the older `c7a6bded…` / `dec1ba99…` runtime chain, so the
candidate's own manifest test passes only because those stale fields agree
with each other.  It is not a source-bound release candidate for `c7a96d48`.

The current DEX owner worktree additionally has unrelated removed Finance
evidence and untracked local-delivery material.  This Finance-suite task did
not touch it.

## Required Central path authority

Grant one source-only lock covering exactly this coherent manifest set before
any package, public deployment, Wallet approval, swap, liquidity or
transaction work:

1. `release/product-release.json`: `commit`, `runtimeCommit`, and every
   source-bound local component must bind the approved DEX candidate.
2. `release/integration/ynx-dex-contract.json`: `sourceCommit` must equal
   `release.runtimeCommit`.
3. `public-product-metadata.json`: `sourceCommit` and
   `artifactSourceCommit` must equal the same release checkpoint.
4. `release/operator-inputs.request.json`: `runtimeSourceCommit` must equal
   the same release checkpoint.

These are shared release records, not `apps/dex/**`; this owner must not edit
them without that exact lock.

## Frozen pre-lock values from `c7a96d48`

| Path | Git blob | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `release/product-release.json` | `a2b0ce2d4a35d81c7ddeb5a2cc3381194ae93cc0` | 2762 | `7a7c97291d283cd01252de97a76672801c3a69836c36f5b95fc2304fe4cecfb0` |
| `release/integration/ynx-dex-contract.json` | `e264b9c5b66bfbc722d49c7ebaba2b3657e70363` | 7764 | `3d2b435c3ecb555a01cb6f8277a84ab5452d38e3a93d5ee1bab98e8250a7a42a` |
| `public-product-metadata.json` | `9a84e3fb132f055cf9f5d99c3e7d893b032548a8` | 7964 | `8039b7331cfff889ff46caa3e2337fc38c8003dd97a5b508f2baaf9309388aa9` |
| `release/operator-inputs.request.json` | `1d760af388c87f291005e4df6c38c8c625aefb5b` | 2338 | `f2b31ee05b6e9879a48a45476aa19d11a081cd45fbdd2d7185cbefb67204aea7` |

`node scripts/dex/check-manifests.mjs` passed when run against an isolated
archive of `c7a96d48`; that confirms only internal consistency of the old
binding, not a public DEX release.

## Required successor evidence

After Central grants the four-path lock, freeze all four new blobs and run:

```sh
node scripts/dex/check-manifests.mjs
node scripts/dex/verify-artifacts.mjs
npm test --prefix apps/dex
npm run build --prefix apps/dex
```

Then submit a separate DEX-only package/deployment request with fresh runtime
and rollback facts.  All public, installed, account, signing, swap, liquidity
and transaction truth values remain **false** until that later request has
direct evidence.
