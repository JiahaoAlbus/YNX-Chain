# Project State

Updated: 2026-07-04

- State snapshot baseline commit: `7416385 Add continuous objective state gate`
- Last pushed commit known locally at snapshot time: `7416385`
- Chain repo state: `/Users/huangjiahao/Desktop/YNX Chain`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain.git`, changed in this update only in remote blocker diagnostics and this state file.
- Website repo state: `/Users/huangjiahao/Desktop/YNX-Chain-website`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain-website.git`, latest observed commit `1ddc977 Harden website readiness and deployment`.

Completed modules in the chain repo:

- Local chain, faucet, indexer, explorer service code exists with Go tests.
- Deploy, dry-run, verify, ops, backup, rollback, host-key audit, legacy inventory, remote smoke, public proof, and package commands exist.
- `remote-smoke-test` checks public RPC, EVM RPC, REST, gRPC, faucet, indexer, explorer, AI, and Web4 endpoints before mutable proof actions.
- Legacy backup coverage is wired into deployment and ops checks.
- `remote-blocker-report` classifies node failures and public endpoint failures instead of only pasting raw error blocks.

Incomplete modules or requirements:

- New remote `ynx_6423-1` public testnet is not proven live.
- Four-node remote validator set is not proven live.
- Public endpoints are not proven to serve the new network.
- Faucet, explorer, indexer, AI, Pay, Trust, Resource, IDE, and website status are not proven against the new remote network.
- Real `.env.deploy` is not present locally; only env templates are present.

Remote deployment state:

- `make host-key-audit` on 2026-07-04 failed with classified node blockers: primary, Singapore, and Silicon Valley are `ssh-connection-closed`; Seoul is `ssh-strict-ok-keyscan-no-keys`.
- `remote-smoke-test` evidence generated at `2026-07-04T10:41:00.479Z` failed with a mixed public state: legacy-chain evidence on indexer/Web4, wrong EVM chain id `0x238e`, empty validator set evidence, gRPC/faucet/REST/AI timeouts, and explorer 404s.
- `remote-blocker-report` generated `tmp/verify-testnet/REMOTE_BLOCKERS.md` with classification summaries for these SSH and public endpoint blockers.
- This is not public proof.

Current blockers:

- Remote SSH is not currently deployable from this machine: three nodes close the SSH connection, and Seoul passes strict SSH but fails host-key scanning.
- Public service endpoints still prove old-chain or broken state, not new `ynx_6423-1` readiness.
- Real deploy env values and secrets are not available in a committed-safe form.

Largest real gap that can still be advanced in-repo:

- Restore or confirm remote SSH and public ingress availability, then run backup, deploy, verify-testnet, and public-proof with real `.env.deploy` outside git.
