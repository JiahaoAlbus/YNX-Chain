# Contracts R1 frozen source boundary

2026-10-18 source candidate: 12 Go files and one protocol document. This extends the successful aa97f102fc72ee89ef3c61b6125256b288694b39 baseline plus the separately frozen Resource Market candidate now selected by the parent for its next CI wave. This candidate is not covered by Run4 or that Resource Market selection.

No git add or commit was performed by this owner. Parent staging must take the complete set together; source helpers cannot be cherry-picked without the state, query and execution wiring. The Resource Market manifest remains unchanged as its earlier boundary.

| Path | SHA256 |
| --- | --- |
| internal/chain/consensus_migration.go | 94eaec0459a8e7cff3e2e596aef932795c877e240433cb63ba1bc1dbcd952418 |
| internal/chain/consensus_migration_runtime.go | df32ca4ebb6350b38cc928bbe8484a7a5f551ea49d6a1300f85c04293b6da686 |
| internal/chain/consensus_migration_contracts.go | 04021ec747eb001648bee2a27162339027a3c5f081fdd63a1e145c9356ca2711 |
| internal/chain/consensus_migration_contracts_test.go | 38e2ee96043e02f1de818a33988b87e89fd35dd2507f78d58a305c4c55fa1f95 |
| internal/consensus/application.go | 4e5dc72f832bc049c88c2b7c4291796286d616137c19e31cac0e553525302006 |
| internal/consensus/state.go | 6a71ef8e2476a32f7c31c5139cc86c90b01f400a6dca547f2518d9a55ec5a5df |
| internal/consensus/migration_runtime.go | 833b040b44ccefeff0d3bae1a7a888a906e1cad506c744b12fba9cf1af311228 |
| internal/consensus/ide_action.go | 8a48be490fa0005a47f7e1121cff0efdfda98dcc8ffc10be39778602ed88c706 |
| internal/consensus/ide_application.go | 02467e239c8ca010e36355d8fbffc458f291b089c578714aa0ea00458104cda4 |
| internal/consensus/migration_contracts.go | b908866fafba96d471976a9351c26d2af34d4bebb8f75fd341f3e2acf71f5dac |
| internal/consensus/migration_contracts_query.go | 895002fae7d9250a44ab52e5b5768f3874c2bb291f9e4f0b0b91ec3c98f6d3bd |
| internal/consensus/migration_contracts_test.go | 0467fb523f5f60905807372688d8be00634327d7e1594c72ba526da2a3eea7c3 |
| docs/protocol/consensus-state-contracts-r1.md | d161f19b7286d5db9f3b1d14aa085c1553520bcb5afd06dc5be9443743e9b87c |

Static verification: gofmt and git diff --check both exited 0. No Go compilation or tests were run by this owner. Execution requires the normal pinned Hardhat builds for both SampleEVMWriteCounter and SampleYNXTCompatibleERC20 plus contracts:selectors, followed by the focused commands in the protocol document and complete chain/API/consensus suites.
