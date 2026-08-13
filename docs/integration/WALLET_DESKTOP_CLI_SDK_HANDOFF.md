# Wallet desktop, CLI and SDK handoff

This product-owned slice consumes, and does not redefine, Core and Wallet/Auth. The frozen protocol is `YNX_PRODUCT_SESSION_HTTP_PROOF_V1`; the source vector is `packages/wallet-auth/testdata/product-session-http-proof-v1.json`. The CLI only verifies that vector, creates an ephemeral P-256 proof for a local self-test, or checks the public EVM endpoint for exact chain ID `0x1917`. It does not persist a private key, fabricate a provider, show balances, or submit a transaction.

Release state is fail closed: `implementedLocal=true`, `testedLocal=true`, `installedLocal=true` only for macOS arm64 CLI, and `integratedCentral=false`, `deployedStaging=false`, `deployedPublic=false`, `downloadHosted=false`, `productionSigned=false`, `storeReleased=false`. Cross-built macOS x64, Linux x64/arm64 and Windows x64/arm64 executables are build-tested only, not installed or runtime-tested. The macOS artifacts carry Go linker ad-hoc signatures; Linux and Windows artifacts are unsigned.

The first slice intentionally uses a distribution-independent compressed executable rather than claiming a desktop GUI or installer. Windows installers, Linux AppImage/deb/rpm, a macOS application bundle, TypeScript SDK packaging, runtime tests on native x64/Windows/Linux hosts, production signing, hosting and upgrade channels remain subsequent gates.
