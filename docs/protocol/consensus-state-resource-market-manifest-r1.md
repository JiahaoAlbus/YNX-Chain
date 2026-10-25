# Resource Market R1 frozen source boundary

Frozen for parent selective staging on 2026-10-18. This manifest records 7 Go source/test files plus the design document. These files are source candidates; no Resource Market Go tests have been executed. Parent Run3 commit ea10ad31a94f80698b73a49ba7638275b5cb571a did not contain this candidate.

The separate DEX fix in internal/chain/consensus_migration.go and consensus_migration_runtime_test.go is excluded. Contracts work begins in new files only while this boundary remains frozen.

| Path | SHA256 |
| --- | --- |
| internal/consensus/migration_resource_market.go | 045861cce984320df9ee08769bcc60b381672a8c688b4b274555727d1693cc93 |
| internal/consensus/migration_resource_market_query.go | f245b45e58ee7ff61e2d39a6f9ab32f65b3177d52a3837262d5f2c4e58231f27 |
| internal/consensus/migration_resource_market_test.go | 8a6b563798a3ec972a5e3f2a1d061dfae1165640648c9c4242a38e8273a912af |
| internal/consensus/state.go | 2780cd34c7d5d37381cc01c5748345c304a51ba4f92751c3b73b2757f6b710c3 |
| internal/consensus/application.go | c9c9ef012348f22b8df10134bc04070ed564e44166a8ec86086fe9e26fb7dada |
| internal/consensus/migration_runtime.go | 76f27015b40ba25f04078887dcd728737b69840937d9aedb9c2b6658f8d0b6f9 |
| internal/consensus/resource_application.go | bcfc01ddeeb57fba09cf6d30baa7f2034e1c1c94bb1253ad776c6a97b8852de6 |
| docs/protocol/consensus-state-resource-market-r1.md | 8ef589b082773ecc99f4c2f897b99ef1f0f2d86b4d8c27fe8221af2721fa5f43 |

Validation at freeze: gofmt completed earlier; git diff --check reported exit 0. No compiler, service, node, or deployment was run for this candidate. Actual execution remains the next remote CI gate.
