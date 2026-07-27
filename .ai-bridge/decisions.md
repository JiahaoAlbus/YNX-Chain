# YNX Wallet/Auth decisions

1. Wallet custody remains native-mobile-first. Web is documentation/status/download only; browser products use product-scoped sessions and native Wallet approval.
2. The runtime SBOM generator is pinned to `@cyclonedx/cyclonedx-npm@6.0.0` and must use `--output-reproducible`.
3. `--ignore-npm-errors` is prohibited for release evidence. Any npm tree error, stale SBOM, duplicate component reference or missing license metadata fails the Wallet check.
4. CycloneDX dependency edges may reference omitted development/optional nodes; the gate does not invent a stricter graph rule than the generated runtime profile supports.
5. Hosted Android/iOS Simulator files remain engineering evidence, not production-signed or store-released artifacts.
6. Central Registry/Gateway, Smart Account Testnet deployment and cross-product Testnet execution remain owned by their canonical owners and 29 Integration; this worktree supplies contracts, vectors and fail-closed adapters only.
7. `packages/wallet-auth/scripts/ynx-wallet-gatewayd.mjs` is intentionally tracked as executable: it has a Node shebang and is the package's declared `ynx-wallet-gatewayd` CLI bin. The coverage gate verifies the mapping, shebang and owner execute bit.
