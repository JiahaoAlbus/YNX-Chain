# DEX public-runtime single-use lease request

## Scope and truth boundary

This is a DEX-only, source-only preparation request. It grants no deployment
authority while Central Heavy P0-179 remains active. It does not mention or
alter Exchange, Quant, Finance, or Pay.

The deployable candidate is frozen from exactly
`7563dc6604540715f87d4e1e46b4ed41feaf6235`, tree
`a7edd2575d8f6f6d21abbd10baec26dcfbdbddbb`. It is a Linux amd64 runtime
bundle, not evidence of a public deployment, Wallet approval, signature,
transaction, or Product Session.

## Immutable candidate

- Archive: `release/dex/ynx-dex-7563dc660454-runtime.tar.gz`
- Archive SHA-256: `4d80b76890191ff93feb75e3bd4214078d1ad9e269d54829f4c3781e082fd092`
- Archive bytes: `3124626`
- Release root after extraction: `ynx-dex-7563dc660454`
- Linux amd64 executable: `ynx-dex-indexerd`, SHA-256
  `b3a558af9bf2a8491a6e54b843687db461decfc9ff49748bdcf845d6f5141605`,
  `6942868` bytes, ELF x86-64 static executable.
- Full inventory: `release/dex/ynx-dex-7563dc660454-runtime.inventory.json`,
  SHA-256 `b7e55c11e64638993d2980db5be781693f11a2b14a73b43752b5da9fea3405a0`.
- Deterministic packager: `scripts/package-public-runtime.mjs`, `4202` bytes,
  SHA-256 `70658ea608cf4a44f70f54782dc61f3b64e9c111e6a388687ec0a01eb15a75d4`.
- Deployment/rollback command: `scripts/dex-public-runtime-release.sh`,
  `7936` bytes, SHA-256
  `2d5716c6cd241c0df63c26d134507e7efae93e59ef57a08c0bf1c1d9e825be48`.

The archive was built twice from the exact detached source checkout; both the
Linux binary and archive hashes matched. Its package contains the executable,
all served Web assets, token list, Caddy template, systemd unit template, env
template, `BUNDLE_MANIFEST.json`, and `SHA256SUMS`.

## Local preparation checks

- `npm test --prefix apps/dex`: 24/24 tests passed.
- `npm run verify:canonical-authorize --prefix apps/dex`: scanned 14 DEX files
  and passed the shared Provider Discovery connection-state gate.
- `go test -race ./internal/dex ./cmd/ynx-dex-indexerd`: passed.
- Two Linux amd64 executable builds and two complete runtime archives were
  byte-identical; extraction plus `sha256sum -c SHA256SUMS` passed.
- The served-asset scan found no bare `ynxwallet://authorize` reference. Source
  maps are deliberately excluded from the public runtime archive.
- The release command passes `bash -n` and rejects an unsigned/missing stage
  archive before creating a release or backup path.

These are source/build checks only. They establish none of the public runtime
or Wallet E2E claims.

## Required fresh, signed runtime binding

Before a future single-use deployment lease, Central must perform a fresh
read-only inspection and bind all of the following in its signed JSON. No
historical DEX release, hash, target, service state, or public response is an
acceptable substitute.

- Current `dex-current` realpath; candidate target exactly
  `/opt/ynx/dex-7563dc660454`; immutable stage archive exactly
  `/opt/ynx/stage/dex/sha256-4d80b76890191ff93feb75e3bd4214078d1ad9e269d54829f4c3781e082fd092/ynx-dex-7563dc660454-runtime.tar.gz`.
- Current indexer executable, Web `index.html`, active JS/CSS assets, `/`,
  `/version`, and `/health`: HTTP status, bytes and SHA-256, plus parsed prior
  source/release identity.
- `ynx-dex-indexerd` service active state, PID/restart count, unit path/hash,
  env path/hash, Caddy route path/hash, state path and either its exact
  SHA-256 or an explicit absence receipt.
- New backup directory exactly `/opt/ynx/backups/dex/<signed-lease-id>`;
  it must not exist before execution.
- Candidate local and public `/`, `/version`, and `/health` expected bytes and
  SHA-256, including the source/release identity
  `7563dc6604540715f87d4e1e46b4ed41feaf6235` / `ynx-dex-7563dc660454`.

## Frozen execution and rollback

The signed lease must stage the immutable archive and binding JSON, verify the
archive before any mutation, extract to the candidate release, atomically
switch only `dex-current`, and restart only `ynx-dex-indexerd`. Unit, env,
Caddy and live configuration are verification inputs: this runbook never edits
them. On the first failed restart or local/public verifier, it stops the
candidate, restores the exact previous symlink and state backup (or deletes
only the exact recorded candidate-created state inode), restarts the previous
service, and proves the prior public hashes before producing a rollback receipt.

The exact command bytes are the checked-in release script above. The permitted
forms are:

```sh
scripts/dex-public-runtime-release.sh deploy /opt/ynx/stage/dex/leases/<signed-lease-id>.json
scripts/dex-public-runtime-release.sh rollback /opt/ynx/stage/dex/leases/<signed-lease-id>.json
```

Required receipts are `preflight.json`, state absence/backup and
candidate-created-inode records, candidate archive and `SHA256SUMS` verification,
local/public version-health-index hashes, `deployed.json`, and on failure
`rollback.json` with restored public hash checks. A failed lease is terminal and
non-reusable.

## Requested permission

Only after P0-179 is released: one DEX-only, single-use lease to perform the
fresh read-only binding, stage this exact archive, execute this exact command,
and retain receipts. No wallet authorization, signature, transaction, liquidity
operation, or external DApp workflow is in this lease.
