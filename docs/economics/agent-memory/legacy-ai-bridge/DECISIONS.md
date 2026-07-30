# YNX 17 Economics Decisions

1. Keep the frozen Integration Bundle and Store bound to `72591ce6ab9eb4ae7878fcf6369c9aac37e7fba9`; their deterministic hashes must not be rewritten to match newer evidence or documentation commits.
2. Bind the local Testnet evidence runtime separately to `f14d002a39cedca18b094e856adc7da888d376da`.
3. Treat local transaction, block and receipt objects as deterministic simulation only. They cannot set `integratedCentral`, `sharedTestnetEvidence`, `deployedPublic` or `production` true.
4. Reject semantically rewrapped bundles as evidence sources even when they contain identical economic facts.
5. Keep unsigned local artifact installation separate from hosting and production signing. Persisted install evidence may promote only `installedLocal`.
6. Pin the Economics source commit and one independent consumer source commit for each required shared-Testnet owner. Do not require unrelated owner worktrees to share one Git SHA.
7. Require all five owners to sign the same canonical payload in canonical owner order. Missing, duplicate, reordered, stale, future-dated, rebound or tampered evidence fails closed.
8. A passing shared-Testnet acceptance fixture proves validator behavior only; it is not central owner acceptance or shared-Testnet deployment evidence.
9. Do not modify the three non-Economics key-permission tests; record their umask-sensitive baseline failure for their owning threads.
10. Do not request secrets in chat. Stable settlement, Treasury signing and production activation remain external-input boundaries.
11. Use the process system clock for shared-Testnet proof freshness. Do not expose an operator-controlled acceptance-time flag that could backdate expired evidence.
12. Persist only the verified acceptance summary, owner source bindings and hashes in the 0600 Store; keep original owner attestations in the operator evidence document.
13. Treat exact evidence/policy replay as idempotent, but reject policy rebinding, reused Economics source commits, transaction hashes or Store state hashes.
14. Add the acceptance CLI as the fifth unsigned Testnet binary; do not replace the persisted four-binary Artifact Evidence until a five-binary builder commit exists and direct evidence is regenerated from that exact commit.
