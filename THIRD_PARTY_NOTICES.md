# Third-Party Notices

New YNX Data Fabric builds require Go 1.25.13 and use the standard library, repository-owned packages, PostgreSQL driver `github.com/lib/pq` 1.12.0 (MIT), NATS client `github.com/nats-io/nats.go` 1.52.0 and its `nkeys` 0.4.15 / `nuid` 1.0.1 dependencies (Apache-2.0), `github.com/klauspost/compress` 1.18.5 (Apache-2.0), and `golang.org/x/crypto` 0.55.0 (BSD-3-Clause). The existing `release/go-runtime-sbom.spdx.json` is a historical Go 1.25.12 inventory and must be regenerated against a final 1.25.13 binary before distribution. Go is distributed under its BSD-style license.

Contract artifact generation uses Node development dependencies. The exact package/version/license inventory is in `release/npm-sbom.spdx.json`. Most packages declare MIT; `semver` declares ISC, `tslib` declares 0BSD, and `typescript` declares Apache-2.0. Package copyright and full license texts remain governed by their upstream distributions and must accompany any distributed build-tool bundle.

Key direct build tools:

- Hardhat 3.11.1 — MIT.
- `@nomicfoundation/hardhat-ethers` 4.0.15 — MIT.
- ethers 6.17.0 — MIT.
- TypeScript 5.9.3 — Apache-2.0.
- undici 6.28.1 — MIT.
- adm-zip 0.6.1 — MIT.

PostgreSQL is used as an operator-provided database under the PostgreSQL License. NATS Server is used as an operator-provided broker under Apache-2.0. Neither server binary is bundled by the current source package.

This notice is not a substitute for legal review. Before a public release, verify both generated SBOMs against final lockfiles and artifacts, bundle all required license texts, and review source/code/data licenses, jurisdiction, terms, retention and data rights for every external provider.
