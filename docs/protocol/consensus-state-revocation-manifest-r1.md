# ABCI account revocation source freeze R1

Owner: consensus_pq. Worktree: `/Users/huangjiahao/.codex/worktrees/ynx-pq-public-upgrade/YNX Chain`.

Base HEAD observed: `83beea24810ba8b77293629405798224bcec8196`. Prior Contracts freeze is already committed and remains independent of this working-tree wave. This manifest contains 8 Go paths and 1 protocol document. The manifest itself is additional. No git add/commit was performed by this owner.

Local validation: gofmt parsed/formatted all eight Go files; gofmt -l returned no paths; git diff --check returned exit 0. No local Go compile/test, heavy work, service, deployment or runtime success is claimed. The final response supplies this manifest file hash, which cannot be self-embedded.

Prerequisites: existing ynxauth revocation v2 and policy-owner Devnet historical/continuation hooks. The chain migration test reuses the policy owner's frozen genuine-signature fixture helpers. Shared source-history metadata repair remains separately owned.

| Path | SHA256 |
|---|---|
| `internal/consensus/account_policy.go` | `69815cc95667e888f5b18bb019fa6e829ec7d6fe91679bca7aa2e6f596edebf3` |
| `internal/consensus/action_transaction.go` | `10d895ba04dc4e5850ae81d38ff710d2b6b9b6e8dcc927111751023214749f41` |
| `internal/consensus/application.go` | `586d5b342ad97b8ea6a06fc63d4cd3cd14ce191c629c544b597303d47c99d402` |
| `internal/consensus/state.go` | `9d9c296db342221cd6589a2ab1e67d4ea9b0c838e6fc9f053782f8babfdfa4b4` |
| `internal/consensus/account_revocation.go` | `fbd40bcf997e76e59eec906b0873d9055c59899f3db20004f7fe3c7f3d22acaa` |
| `internal/consensus/account_revocation_test.go` | `bb4442e5057bd540b6e49cb131cbd59f42315214a9103a02476a27f5fe2f728d` |
| `internal/consensus/migration_revocation_test.go` | `c1a99921feae7e7a89bf7b1c68622cc51f9c2109cdb296eaa517b5036a309617` |
| `internal/chain/consensus_migration_revocation_test.go` | `a65e30a34d8e3c1908bbb5e64298399d4e81b60b4901c8f11aa7ec154eeb131e` |
| `docs/protocol/consensus-state-revocation-r1.md` | `6f0602eb6775bf8bfc4188ce5c2b349221df0a2f7176fe87a1cc8142755e931a` |

Focused remote commands:

```sh
go test ./internal/chain -run '^TestConsensusMigrationRevocation' -count=1
go test ./internal/consensus -run '^TestABCI(Revocation|MigratedRevocation)' -count=1
```

Written tests: 5 TestABCIRevocation cases, 1 TestABCIMigratedRevocation case and 1 TestConsensusMigrationRevocation case, with subtests for independent signature branches, invalid execution effects and rehashed history omissions/forgeries. Full package/production compile and runtime results must be reported from separate CI evidence.
