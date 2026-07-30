# YNX 29 Integration Open Dependencies

Updated: 2026-07-27T14:54:30Z

These are unresolved engineering or owner dependencies, not requests for ordinary implementation decisions.

1. **Security/SRE authority:** No `codex/final-security-sre` branch or `30-security-sre` registered worktree was observed. Recovery condition: an exact owner branch with its contract, security/release/backup policy, test vectors and source-bound evidence becomes available.
2. **Missing remote final branches:** The latest scan found fewer remote branches than local final branches, including dependencies required by Integration. Recovery condition: product owners push their declared final branches and configure upstream without force-pushing.
3. **Dirty product-owner worktrees:** Most registered product worktrees were dirty during the scan. Recovery condition: each owner protects, tests, commits and pushes its changes; Integration then rescans a stable exact ref.
4. **Phase 0 authority acceptance:** 01, 17, 19, 21, 26, 30 and 31 have not all passed central contract and negative-vector review. Recovery condition: exact bundles are available and central tests pass.
5. **GitHub Actions observation:** The latest Actions API call failed after two TLS handshake timeouts. Recovery condition: a later bounded query succeeds; current Release and Artifact evidence remains independently available.
6. **Hardhat advisory review:** The exact development-only `adm-zip` advisory graph has a policy that expires on 2026-08-31. Recovery condition: product 30 accepts the bounded policy, Hardhat removes the dependency, a compatible fixed dependency is verified, or the toolchain is replaced. Production release remains blocked until one condition is met.
7. **Shared Testnet and public proof:** No complete cross-product Testnet, cross-region smoke, restore/rollback drill or independent public proof has been centrally accepted. Recovery condition: FREEZE and INTEGRATE gates pass, followed by exact Testnet receipts and public probes.
8. **Operator inputs:** Signers, provider access, funding, DNS, legal review, store credentials and production signing are not requested yet because autonomous central review and adapter/test work remains open.
