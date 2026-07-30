# YNX 29 Integration Decisions

Updated: 2026-07-27T14:54:30Z

1. **Fast-forward rather than merge or rebuild.** The original Integration HEAD was a direct ancestor of `origin/main` with no unique commits, so the branch was advanced using `--ff-only` and pushed without rewriting history.
2. **One registry covers 01–36.** The previous 23-product matrix remains historical evidence only. `release/integration/product-registry.json` is the current machine-readable owner, branch, phase and dependency inventory.
3. **Product-owner evidence is never central acceptance by default.** `acceptedSourceCommit` remains null until Integration reruns the relevant contract, negative, artifact, migration, restore, security and public checks.
4. **Evidence identity must match the product.** A file inherited from another branch or product cannot satisfy a row merely because its filename matches. Owner, ID, slug, branch or exact product identity must match.
5. **Query failure is not zero.** Unavailable GitHub Actions, Release or Artifact observations use `null` counts plus retained error evidence; they are never converted to an empty-success claim.
6. **Release classes remain separate.** Preview, simulator, unsigned, test-signed, staging, public runtime, production signing, store release and Mainnet states cannot promote each other.
7. **Integration public records are namespaced.** Integration uses `release/integration/product-release.json` and `release/integration/public-product-metadata.json`; the root Docs/Compliance records are not overwritten or reused.
8. **Security/SRE absence fails closed.** Product 30 is a Phase 0 authority. Its missing final branch/worktree blocks dependent promotion but does not stop independent scanner, contract, test-vector and evidence work.
9. **Dirty sibling worktrees are protected, not accepted.** The controller records only clean/dirty counts and branch facts; it does not modify sibling worktrees or disclose their absolute paths.
10. **Mainnet remains independent.** No Testnet, Website, Release or Artifact result may set Mainnet acceptance without a later explicit gate.
11. **Unsafe-permission tests must be umask-independent.** Tests that assert rejection of group/world-readable key files explicitly set the unsafe mode after creation; production permission checks remain unchanged.
12. **Contract artifacts are generated prerequisites, not committed fixtures.** Hardhat artifacts remain ignored and are regenerated from tracked Solidity before dependent Go tests. Tests are not weakened or skipped to hide missing artifacts.
13. **The Hardhat High advisory has a bounded exception, not a release waiver.** The exact development-only graph is machine checked, production audit must remain zero, the exception expires on 2026-08-31, and production release remains blocked pending Security/SRE review or remediation.
14. **Dirty-tree tests do not earn exact-source status.** The implementation slice is committed first as `implementedLocal`; only an exact-commit rerun may set `testedLocal` and produce direct evidence.
