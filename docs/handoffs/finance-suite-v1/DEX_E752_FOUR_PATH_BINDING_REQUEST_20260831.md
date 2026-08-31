# DEX e752 coherent release-binding request — 2026-08-31

## Supersedes source selection only

This request supersedes the **candidate selection** in `DEX_C7_FOUR_PATH_BINDING_REQUEST_20260831.md`; it does not alter that document, any shared manifest, release status, deployment, Wallet scope, or chain execution.

The current DEX owner head is `e752a9cc190fcbd5e4bd7f3799dc9b2645a1154f` (tree `5cb826f278b617f7d3ba7e79ad0fad249251eb2d`). It descends from C7 but adds the multihop quote-router/provenance work, wallet restore boundary, legacy-route quarantine, E2E updates, and source-bound candidate material. It must be the sole candidate in any new DEX release binding; the older `c7a96d48f17f9dc70bbdc42389cf1052771ee904` is no longer sufficient.

## Local candidate evidence

- Isolated `git archive` build from `e752a9cc`: pass.
- Focused tests: 33/33 pass.
- Isolated Playwright E2E: 7 passed, 1 skipped. The skipped case is not promoted to success.
- Candidate PWA archive: `/tmp/ynx-dex-e752a9cc190f-pwa-source-candidate.tar.gz`, 599,040 bytes, SHA-256 `92ccf8ebb81a08c7d635974e09d0704c6f801eabf9545b08d8940bc5af4e055f`.
- Sorted ten-file PWA inventory: `/tmp/ynx-dex-e752a9cc190f-pwa-source-candidate.sha256`, 850 bytes, SHA-256 `d093d524bd2a227b0a92321f666f8970f2091a33db3f516ee2dfbb9126bf29bf`.

These are local source artifacts only. They are not hosted/downloadable, publicly deployed, Wallet-approved, signed, or Testnet swap/LP evidence.

## Exact Central path lock required

Grant a single source-binding lock for only the following shared records:

1. `release/product-release.json`
2. `release/integration/ynx-dex-contract.json`
3. `public-product-metadata.json`
4. `release/operator-inputs.request.json`

After the lock, every DEX source/runtime/artifact source field in all four records must bind **exactly** `e752a9cc190fcbd5e4bd7f3799dc9b2645a1154f`, with a coherent release checkpoint and no retained `c7a6bded387223429f0708f80b50f086d8ff944d` or `dec1ba994c7c9d48fb4708f37765cb3fe90e2e0f` binding.

## Pre-lock state frozen from e752

| Shared record | Git blob | Bytes | SHA-256 | Current incompatible reference |
| --- | --- | ---: | --- | --- |
| `release/product-release.json` | `a2b0ce2d4a35d81c7ddeb5a2cc3381194ae93cc0` | 2,762 | `7a7c97291d283cd01252de97a76672801c3a69836c36f5b95fc2304fe4cecfb0` | `c7a6bded…` |
| `release/integration/ynx-dex-contract.json` | `e264b9c5b66bfbc722d49c7ebaba2b3657e70363` | 7,764 | `3d2b435c3ecb555a01cb6f8277a84ab5452d38e3a93d5ee1bab98e8250a7a42a` | `dec1ba99…` |
| `public-product-metadata.json` | `9a84e3fb132f055cf9f5d99c3e7d893b032548a8` | 7,964 | `8039b7331cfff889ff46caa3e2337fc38c8003dd97a5b508f2baaf9309388aa9` | `dec1ba99…` |
| `release/operator-inputs.request.json` | `1d760af388c87f291005e4df6c38c8c625aefb5b` | 2,338 | `f2b31ee05b6e9879a48a45476aa19d11a081cd45fbdd2d7185cbefb67204aea7` | `dec1ba99…` |

## Required post-lock gates

Run `node scripts/dex/check-manifests.mjs`, `node scripts/dex/verify-artifacts.mjs`, `npm test --prefix apps/dex`, and a fresh isolated build. A separate DEX-only deployment/rollback lease is still required before any public runtime, download, Wallet approval, swap, liquidity, or transaction action.
