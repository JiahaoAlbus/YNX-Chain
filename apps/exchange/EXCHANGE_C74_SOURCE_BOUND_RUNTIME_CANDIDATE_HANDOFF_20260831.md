# Exchange c74 source-bound runtime candidate

This is an unsigned local Linux amd64 candidate for Exchange source
`c74d6524fc40ef57d5e571ba31586a975af2b08f` (tree
`f31f6eb7637c3650f2e080ae17d59ceeeab163b3`). It does not supersede a public
runtime or authorize a deployment.

## Exact candidate

- Archive: `apps/exchange/evidence/release-candidates/ynx-exchange-c74d6524fc40-runtime.tar.gz`
  — 3,503,861 bytes, SHA-256
  `9e16fc1c6964aed365a74a24ceb6abe6cef45c7d875e78701991d7e571a97ce2`.
- Binary: 7,947,794-byte static Linux amd64 `ynx-exchanged`, SHA-256
  `1d0207526e2bb6c9611e608eb9170d07e33109d501d32de57d9e82848f897619`.
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

- `/api/health`: 237 bytes, SHA-256
  `47afdf2e0b44c85c4200140e0e393e093561fdd9388aea5044b65dfd9d4b26f8`.
- `/api/version`: 131 bytes, SHA-256
  `3c3f15c8e13be9313c4818e6cce55f0108fe97affb6dc26f277381f44a2a9763`.
- English guest index: 11,368 bytes, SHA-256
  `7e397fa8ba5e0ae6dad4f54dd7a794189bfa46ead8ba1e596af0e4bbfe63bc7b`.

The Linux candidate was not executed on this macOS host; an ELF candidate is
not installation or public-runtime evidence.

The local browser gate now passes all three non-sensitive checks: desktop,
mobile, and an absent-provider flow. Selecting the top-level **Connect YNX
Wallet** control performs YNX provider discovery; with no injected provider it
keeps the page URL stable and exposes the truthful YNX Wallet download and
MetaMask routes. This did not request an account or perform a signature,
transaction, order, or Product Session operation.

## Public and execution boundary

Current `exchange.ynxweb4.com` root, health and version still return one shared
18,603-byte HTML fallback, so none proves a public Exchange service or binds
this source. Central must fresh-bind the actual host, service, environment,
static root, unit, Caddy, state, active release and rollback target; freeze an
Exchange-only rollback-first executor; and issue a new single-use lease.

No SSH, deployment, Wallet approval, account request, signature, order,
settlement, withdrawal or transaction occurred. All public and transaction
truth flags remain false.
