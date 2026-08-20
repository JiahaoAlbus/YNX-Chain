# Pre-existing Developer artifact recovery checkpoint

This directory was discovered as untracked, pre-existing work on
`codex/p0-developer-sdk-20260820` at Git HEAD
`315897e75c0ffe3e63435fe73cfec42244b851cc` on 2026-08-20.

It is preserved as a recovery snapshot. It was not regenerated, replaced, or
treated as the current production release. The snapshot contains:

- Web build output in `dist/` and `frontend/dist/`.
- macOS arm64 and Windows x64 unsigned testnet-preview artifacts, including
  their build provenance and native self-test evidence.
- Extracted desktop resources and installed local developer tooling.

Relationship to the current Developer release:

- The authoritative Developer source and pending protected-release work remain
  on `codex/ynx-code-platform-v1` (current known release candidate
  `8238786a6584f504f5d28e236d669ca65fd81ae4`).
- The macOS artifact records source commit
  `76322af5e8c26a64fb6425c51d96c67d2b3df65f`; the Windows artifact records
  `f179654dd6e1361711ee480e2c6f3f614ad38002`. Neither is represented as a
  current public deployment.
- The current P0 DApp SDK remains owned by
  `packages/dapp-connect-sdk/**`; this snapshot is not used to activate any
  Wallet, Gateway, endpoint, or product-session contract.

`RECOVERY_TAKEOVER_SHA256SUMS.txt` is the content inventory taken before the
protection commit. Existing ignored `node_modules` dependency trees are
included in that inventory but stay excluded from Git in accordance with the
repository's existing ignore policy; they are not deleted or altered.
