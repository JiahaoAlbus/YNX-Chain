# YNX DEX current plan

Status: ACTIVE
Phase: FREEZE
Source commit: `4d9f9c807efb2529836a1324b17c697e91a23421`

1. Finish the evidence-only release checkpoint for direct StableSwap Strategy Vault execution: regenerated PWA/SDK/contract manifests, exact hashes, public metadata, Integration Contract and handoff.
2. Run release, manifest, artifact, SDK, PWA, Solidity and Go Race gates after all evidence files are synchronized.
3. Commit and push the evidence checkpoint; verify Local SHA equals Remote SHA and the worktree is clean.
4. Continue the highest-priority autonomous gap: implement a complete indexer backup/restore drill with integrity and RTO/RPO evidence.
5. After recovery gates, freeze the clean-room concentrated-liquidity specification and begin invariant-tested runtime implementation.

External blockers are not product completion: canonical Wallet/Gateway registry acceptance, Oracle/Testnet addresses, secure signer/funding, central integration, independent audit, immutable artifact hosting and Website deployment remain unresolved.
