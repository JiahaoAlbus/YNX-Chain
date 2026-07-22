# Chain Core Recovery Audit

As of: 2026-07-22T14:45:00Z

## Selected recovery state

- The required `01-chain-core` worktree and `codex/final-chain-core` branch did not exist locally or on `origin`. They were created without replacing another worktree or branch, from clean `main` commit `719e1018267ed5a53e6fae5211c5fd8a1503c35c`.
- `main` matched `origin/main` and the recovery source had zero tracked or untracked changes. No reset, clean, forced update, deletion, or rollback was used.
- After a full ref/tag fetch, the shared repository contained 32 local branches, 23 `origin` refs, 4 tags, 1,296 reflog entries, 411 reachable commits, and 33 registered worktrees at the recorded scan point.
- History and path scans recovered the complete CometBFT candidate, ABCI, deterministic migration, production package, cutover, backup, rollback, Gateway, service, and remote-evidence work already present on `main`.
- A newer, single-commit tokenomics candidate added append-only consensus fee accounting and touched Chain Core-owned state/Gateway files. Commit `ff01dcee4c93acfb138dcde91f7605e408b706d5` was reviewed, integrated by cherry-pick, and independently retested. No product worktree was edited.
- Other final-product branches remain separate ownership domains. Their manifests may be consumed later; their working trees and product-specific releases are not copied or rewritten here.

## GitHub recovery

- Four prerelease tags/releases were recovered: Browser & Search, Finance, Mail + Calendar, and Wallet engineering evidence. These are product artifacts, not a Chain Core release.
- Finance release metadata directly exposed the test-signed APK SHA-256 and immutable GitHub release URL. It is not a production-signed Chain Core artifact.
- GitHub Actions run and artifact inventory calls encountered repeated TLS handshake timeouts. This is missing recovery evidence, not proof that no Actions or Artifacts exist. The inventory must be retried before final completion.

## Four-node and public runtime truth

- Strict host-key SSH checks passed for primary, Singapore, Silicon Valley, and Seoul using existing mode-restricted operator inputs.
- Read-only four-node verification passed against deployed release `ynx-chain-02f4ccd8770c`. All nodes exposed matching manifest SHA-256 `77f21c7a5d581af47f579bb33deb3cc4557433d87bb2b81dbc7805bf26998f4c`, matching `ynx-chaind` SHA-256 `a91a6ff83c2f346efd84de8d4b86e1fd991745edd66a0c888cbe9e723c56398e`, active daemon state, expected four-node identity metadata, and live status/identity/validator/peer/sync endpoints.
- This deployed network is still the authoritative producer plus three read-only authenticated followers described by the recovered state. It is not public four-validator CometBFT and must not be represented as such.
- The workstation public-ingress diagnostic classified its route as `transparent-proxy-or-vpn-fake-ip`, passed 13 of 42 bounded probes, and marked direct proof ineligible. Successful individual reads do not override that route classification. Multi-region operator-controlled evidence and an independent direct vantage remain required.

## Recovered gaps that remain authoritative

- Public four-validator BFT cutover, public 3/4 precommit proof, public one-validator fault/recovery, double-sign evidence, public state sync, and public BFT backup/restore are incomplete.
- StreamBFT is a local shadow candidate only. Canary eligibility is false until every formal, differential, validator-count, WAN, fault, state-sync, soak, rollback, and composite bake-off requirement passes.
- Chain-level Smart Account and StrategyMandate libraries, schemas, SDK surfaces, Vault withdrawal boundary, and fee invariants are local implementation evidence only. They are not yet committed into ABCI state or deployed.
- GitHub Actions/Artifacts inventory, public direct-route stability, independent public proof, current-source deployment, security closure, capacity/soak, complete operator inputs, final push, and clean remote SHA verification remain open.
