# Finance EVM read-session Linux amd64 release candidate

Status: immutable local candidate and local Linux cold-start verified; **not deployed**. No production lease or host rollback command is authorized by this card.

## Source, package, and inventory

- Finance source `8b95488f32e2d73d320e8adec1040f45d61dc3ac`, tree `4e85c727dbfcbb0d8f69884be3659ef8aef2c114`; build tooling checkout `5cbc2eee35f474ddb9013d0c8bec037a96111978`.
- Release `finance-weekly-v3-8b95488f32e2-linux-amd64`.
- Archive `apps/finance/evidence/release-candidates/finance-weekly-v3-8b95488f32e2-linux-amd64.tar.gz`: 30,850,090 bytes, SHA-256 `6d64ce0b6046440094ea6468ef39a6b3f0e3d0a41f1190c53d77d1cbb1e6311f`.
- Sidecar `apps/finance/evidence/release-candidates/finance-weekly-v3-8b95488f32e2-linux-amd64.tar.gz.manifest.json`: 535 bytes, SHA-256 `bfb7850ec0f3519d89398bf8eaf3fc88f5bd8b2c9cf8e1bd243fcb6c1fcced0f`.
- Extracted `manifest.json`: SHA-256 `f431474db85ec8bd1b3237a2b713ffe7d4de46f6600a3dc5b677a69eeafe7e17`. It binds all 37 payload files by path, bytes, mode, and SHA-256: four Linux x86-64 ELF binaries, 18 Web files (17 copied plus build identity), 14 authority runtime files, and `.env.example`.
- Service binary `ynx-finance`: 21,024,916 bytes, SHA-256 `1cd827551a6f0e6eead990dece18fe6e6c1f0b2ebdb60a859bd3d213947c1b29`. The static Go route map's 14 distinct served files are all present. The manifest gives every Web asset's exact bytes/SHA; representative bindings: `/` `web/index.html` 23,318 bytes SHA-256 `c38afcbb7344601417f2298e3c5f722ae69cd795eba6405107ca7577852cedb0`; `/app.js` 60,238 bytes SHA-256 `d30e440211eff5d52b8ba46fc4f7d0e16fa6fdb6ac8737e8687f75e774481d23`; `/wallet-auth.js` 181,400 bytes SHA-256 `e04e757f20ff98ef3bbd97ac294c1e6c022c6e93edd1c441e30ac03c1959ed1b`; `/evm-read-session.js` 66,226 bytes SHA-256 `1948d6cb586580505ff92abb0afbdbae596efffbc5904a99a1518aee3c210e34`.

The builder ran twice from a detached exact-source worktree and compared complete compressed archives byte-for-byte. The tracked verifier independently listed and clean-extracted the archive, checked every manifest file and ELF x86-64 header, then used the local `ubuntu:24.04` image `sha256:6232b38791000e3818b58d8847b5a8f5612d606929e01156dd8febc423e0f2ef` for Linux amd64 cold starts. Evidence: `apps/finance/evidence/finance-weekly-v3-8b95488f-candidate-verification-20260925.json`. Absent-state startup left state absent; a version-1 state started read-only and retained its exact disk hash. Local `/health`, `/version`, `/ready`, `/api/broker/status`, `/`, `/app.js`, and `/wallet-auth.js` all returned 200 and were recorded with status, bytes, SHA-256, and type. Broker diagnostics remained `CONFIGURATION_ONLY_NO_NETWORK`, writes disabled, official Sandbox unverified, production unapproved.

Reproduce/verify locally from a clean Finance tooling checkout:

```sh
node apps/finance/scripts/build-finance-weekly-v3-candidate.mjs --source 8b95488f32e2d73d320e8adec1040f45d61dc3ac --output apps/finance/evidence/release-candidates/finance-weekly-v3-8b95488f32e2-linux-amd64.tar.gz
node apps/finance/scripts/verify-finance-weekly-v3-candidate.mjs --archive apps/finance/evidence/release-candidates/finance-weekly-v3-8b95488f32e2-linux-amd64.tar.gz --source 8b95488f32e2d73d320e8adec1040f45d61dc3ac --evidence apps/finance/evidence/finance-weekly-v3-8b95488f-candidate-verification-20260925.json
```

The first command refuses a dirty tooling worktree. The verifier runs local containers only; it does not reach the public Finance host or a provider.

## Deployment and rollback preflight (not executed)

1. Central must first issue a fresh single-use Finance-only lease. Re-read the *live* current symlink and resolved release, binary/env/unit/drop-ins/Caddy digests and modes, state backend/identity, service PID/NRestarts, stage/backup/release/control path absence and parent tuples, and public plus loopback root/health/version/assets. Do not substitute this card's older public observation or any historical lease.
2. Bind those receipts and this exact archive/manifest/binary/Web inventory to a new signed rollback-first command object. Keep current environment values secret; derive candidate environment by changing only the Web directory to the newly immutable release. Validate executable and asset readability as the actual service user before switching. Record a verified backup/restore path appropriate to the live state backend and prohibit replacing post-deploy state with an old snapshot.
3. On a signed deployment, stage and verify exact archive bytes, ownership, no-symlink paths, ELF architecture, inventory and absent target identities before any current/env/service change. An atomic switch and bounded restart must verify source-bound `/version` commit `8b95488f32e2d73d320e8adec1040f45d61dc3ac`, every served asset's status/bytes/SHA, service health/readiness, PID/restart receipt, and private-disabled Broker status. First failure triggers only the signed executor's automatic rollback and old-runtime/public readback.
4. If the candidate becomes live and later needs manual rollback, stop and request a separate signed rollback lease. Preserve the then-current state and retained release/backup/control objects; verify restored previous binary/env/current/service/public hashes. Do not infer permission to delete a release or perform a manual rollback from this candidate.

As observed on 2026-09-25, public `https://finance.ynxweb4.com/version` still reports `c20709da38bc2a4823efb9870046b6afb7775992`, not this candidate. Public Finance deployment, real YNX/MetaMask approval, installed packages, official Alpaca Sandbox, real order execution and chain transactions remain false.
