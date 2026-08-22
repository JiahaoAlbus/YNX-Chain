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
Preview. The exact ZIP is publicly hosted by the GitHub pre-release but remains
unsigned and is not a production distribution.

## macOS desktop runtime

The local macOS package bundles the local Node runtime selected by the package
script. The artifact is ad-hoc signed with no Team ID and is not a Developer ID
or notarized distribution.

## Cloud JUnit test runtime

- Upstream: `https://junit.org/`
- Artifact: `org.junit.platform:junit-platform-console-standalone:1.14.2`
- SHA-256: `5566ffe2aa48263867bca745925f73bf7b01591b30d9a60f191c0b16fa0955e9`
- License: Eclipse Public License 2.0

The reviewed cloud image retains the upstream executable JAR, including its
embedded `META-INF/LICENSE*` files and bundled-dependency notices. The artifact
is used only as the no-network Java project-test compiler classpath and console
runner; it is not included in the current desktop downloads.

## Cloud JavaScript debug adapter

- Upstream: `https://github.com/microsoft/vscode-js-debug`
- Standalone DAP release: `v1.117.0`
- Release asset SHA-256: `ad8d04ede9d4b75cc290fd5438a65047a06f786d04f604b6112485b36f090772`
- License: MIT

The reviewed cloud image retains the upstream `LICENSE` alongside the exact
standalone DAP bundle. YNX Code starts it only inside an owner/project-bound
no-NIC LXD lease and reaches its per-session Unix socket through the bounded
YNX stdio bridge; it is not included in the current desktop downloads.

## Hardhat Solidity project-test runtime

- Hardhat: `3.9.0`, MIT License, `https://hardhat.org/`
- Solidity compiler: `0.8.24+commit.e11b9ed9`, GNU GPLv3
- soljson SHA-256: `fb59b825b7d57f9de89cd9de2415b12aab1fcc7eb2573fd2bf5c9b969eacf4d9`

The server uses these reviewed dependencies only inside the network-disabled
project-test boundary. It does not execute workspace Hardhat configuration,
plugins or package scripts.
