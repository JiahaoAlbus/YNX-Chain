# Third-party notices

The Solidity source under `contracts/dex/**` is a clean-room YNX implementation and does not contain copied Uniswap, Curve, 1inch or other AMM source. Each production Solidity file carries an MIT SPDX identifier. Test-only token contracts are not deployment targets.

Conceptual candidates and exact reviewed revisions are documented in `docs/dex/DEX_ENGINE_EVALUATION.md`. Their notices and licenses remain their owners' property:

- Uniswap v2 core `6a9e7c9…`: GPL-3.0.
- Uniswap v3 core `d0831dc…`: repository BSL-1.1 text with the recorded change-license terms.
- Curve StableSwap NG `2abe778…`: repository-specific all-rights-reserved/informational terms; no copying.
- 1inchProtocol `811f7b6…`: MIT; archived repository.

JavaScript, Go and build-tool dependencies are enumerated in `docs/dex/SBOM.cdx.json`. Generated Hardhat artifacts contain compiler output for the YNX source and are not committed as release evidence.
