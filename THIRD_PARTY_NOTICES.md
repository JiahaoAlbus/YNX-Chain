# Third-Party Notices

This repository uses third-party Go modules and npm development tooling. The complete version inventory is `release/sbom.cdx.json`; `go.sum` and `package-lock.json` are the integrity authorities. License texts distributed by each dependency remain authoritative, and this inventory is not a legal approval for public distribution.

Direct Go dependencies include CometBFT (`github.com/cometbft/cometbft`, Apache-2.0), Decred secp256k1 (`github.com/decred/dcrd/dcrec/secp256k1/v4`, ISC), and Go cryptography extensions (`golang.org/x/crypto`, BSD-3-Clause). Direct npm development dependencies are Hardhat, Hardhat Ethers, ethers, TypeScript and undici; exact versions and transitive licenses are read from package lock metadata into the SBOM where declared.

Before distributing a binary or source bundle, release engineering must collect the corresponding dependency license files, resolve components whose lock metadata omits a license, review notices for bundled native/optional packages, and obtain legal approval. No download-hosted or production distribution is claimed by this local candidate.
