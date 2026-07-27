# YNX 17 Economics Decisions

1. Keep the frozen integration bundle and Store bound to `72591ce6ab9eb4ae7878fcf6369c9aac37e7fba9`; their deterministic hashes must not be rewritten to match a newer documentation commit.
2. Bind the new local Testnet evidence runtime separately to `f14d002a39cedca18b094e856adc7da888d376da`.
3. Treat local transaction, block and receipt objects as deterministic simulation only. They cannot set `integratedCentral`, `sharedTestnet`, `deployedPublic` or `production` true.
4. Reject semantically rewrapped bundles as evidence sources even when they contain identical economic facts.
5. Do not modify the three non-Economics key-permission tests; record their umask-sensitive baseline failure for their owning threads.
6. Do not request secrets in chat. Stable settlement, treasury signing and production activation remain external-input boundaries.
