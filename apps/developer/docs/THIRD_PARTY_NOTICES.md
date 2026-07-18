# Third-party notices

The YNX Developer source tree and local macOS Testnet Preview package do **not**
bundle Grok Build. The optional adapter can interoperate with a separately
obtained, user-approved official executable after checksum verification.

## Optional xai-org/grok-build sidecar

- Upstream: `https://github.com/xai-org/grok-build`
- Pin: `98c3b2438aa922fbbe6178a5c0a4c48f85edc8ce`
- License: Apache License 2.0
- Copyright notice in the audited license: 2023–2026 SpaceXAI
- Full upstream dependency notices remain in the upstream
  `THIRD-PARTY-NOTICES` and `third_party/NOTICE` files at the pinned commit.
- Verified hashes are listed in `GROK_BUILD_INTEGRATION.md` and
  `GROK_BUILD_SOURCE_MANIFEST.json`.

If a future YNX artifact distributes the upstream binary or selected upstream
source, that artifact must ship the exact Apache-2.0 license, applicable NOTICE
content and dependency notices. This file alone is not a substitute.

## Windows desktop runtime

The Windows source references Microsoft WebView2 package `1.0.2903.40`. Windows
CI restores that package and bundles the `node.exe` supplied by the pinned
`actions/setup-node` Node `22.17.0` toolchain into an unsigned portable Testnet
Preview. The Windows CI artifact is not production-signed or publicly hosted.

## macOS desktop runtime

The local macOS package bundles the local Node runtime selected by the package
script. The artifact is ad-hoc signed with no Team ID and is not a Developer ID
or notarized distribution.
