# Exchange 2f1 source-bound runtime candidate

This is an unsigned local Linux amd64 candidate for Exchange source
`2f1b0f8bc08e2abedcf27bf9c2af902e49da4618` (tree
`86a7b8ac89e0665ddc696b554ab408af0249cae0`). It does not supersede a public
runtime or authorize a deployment.

## Exact candidate

- Archive: `apps/exchange/evidence/release-candidates/ynx-exchange-2f1b0f8bc08e-runtime.tar.gz`
  — 3,503,813 bytes, SHA-256
  `34b2ed6464ac031391aedeb062261a931aa94c318c88285ab3a720b6bf641359`.
- Binary: 7,947,794-byte static Linux amd64 `ynx-exchanged`, SHA-256
  `41e1acbbf8bcf518661a4a73ac36c81c0905e7e62eee86590d91a7be59c53c13`.
- The archive keeps `apps/exchange/web` under the release root. That matches the
  server's explicit `apps/exchange/web` working-directory-relative static root;
  unlike the older a9 envelope, its static files are not relocated to an
  incompatible top-level `web` directory.
- The tracked packager
  `apps/exchange/scripts/package-runtime-candidate.mjs` requires exact `HEAD`
  source identity, builds a Linux amd64 binary with injected `BuildCommit`,
  bundles the current Wallet entrypoint, creates a deterministic tarball, and
  emits a bundle manifest and payload checksum list.

## Local evidence

The in-archive checksum list passed. A native development-host build with the
same source commit successfully served the extracted layout:

- `/api/health`: 266 bytes, SHA-256
  `ec83a3383f7dfbe09f8ebffde22f14893bf207f59ce52fce4d8e931392697f1c`.
- `/api/version`: 160 bytes, SHA-256
  `4a37ce396155ed08b6262907272edc5afad7e71d79fac8920c6ad0634b0e06d6`.
- English guest index: 11,368 bytes, SHA-256
  `7e397fa8ba5e0ae6dad4f54dd7a794189bfa46ead8ba1e596af0e4bbfe63bc7b`.

The Linux candidate was not executed on this macOS host; an ELF candidate is
not installation or public-runtime evidence.

## Public and execution boundary

Current `exchange.ynxweb4.com` root, health and version still return one shared
18,603-byte HTML fallback, so none proves a public Exchange service or binds
this source. Central must fresh-bind the actual host, service, environment,
static root, unit, Caddy, state, active release and rollback target; freeze an
Exchange-only rollback-first executor; and issue a new single-use lease.

No SSH, deployment, Wallet approval, account request, signature, order,
settlement, withdrawal or transaction occurred. All public and transaction
truth flags remain false.
