# Current State

Updated: `2026-07-29T19:26:24Z`

Product 29 now contains two evidence-bound central source acceptances.

- Product 30 Security/SRE owner source: `e670749b83a1b40d09ed717eb3515d539c005c49`
- Product 30 Integration merge: `a472d588b4f037c57db6d7941b1b37572f91d114`
- Product 01 Chain Core owner source: `324f376dac2db434673ccec2c6d212ed3d23f79e`
- Product 01 Integration merge: `329092c19794ee376248750c2b138090e8418e08`

Product 01 is clean, synchronized, protected and exact-head green across six workflows. Its source-only prerelease and downloaded archive are verified; the archive SHA-256 is `6828d6c0b008964394716de87646e90ea64b59faaae85be16e030b24c63995b6`. Central Go, Integration contract, release, BFT/EVM, account-abstraction, solvency, state-sync and StreamBFT tests passed.

The 36-product inventory currently has 2 centrally accepted products, 3 source-release-ready classifications, 33 recovery holds and 0 public-Testnet-ready classifications. Product 29 is intentionally ahead of remote while this acceptance checkpoint is being committed.

The global release gate correctly remains closed. Shared Testnet, public runtime, Website proof, production signing, store release and Mainnet release are not implied by either source acceptance.
