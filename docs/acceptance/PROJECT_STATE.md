# Project State

Updated: 2026-07-04

- State snapshot baseline commit: `ef857ce Verify public gRPC endpoint in remote smoke`
- Last pushed commit known locally at snapshot time: `ef857ce`
- Latest `git ls-remote` attempt: failed with `LibreSSL SSL_connect: SSL_ERROR_SYSCALL`; local `origin/main` tracking still matches `HEAD`.
- Chain repo state: `/Users/huangjiahao/Desktop/YNX Chain`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain.git`, clean before this state update.
- Website repo state: `/Users/huangjiahao/Desktop/YNX-Chain-website`, branch `main`, remote `https://github.com/JiahaoAlbus/YNX-Chain-website.git`, latest observed commit `1ddc977 Harden website readiness and deployment`.

Completed modules in the chain repo:

- Local chain, faucet, indexer, explorer service code exists with Go tests.
- Deploy, dry-run, verify, ops, backup, rollback, host-key audit, legacy inventory, remote smoke, public proof, and package commands exist.
- `remote-smoke-test` checks public RPC, EVM RPC, REST, gRPC, faucet, indexer, explorer, AI, and Web4 endpoints before mutable proof actions.
- Legacy backup coverage is wired into deployment and ops checks.

Incomplete modules or requirements:

- New remote `ynx_6423-1` public testnet is not proven live.
- Four-node remote validator set is not proven live.
- Public endpoints are not proven to serve the new network.
- Faucet, explorer, indexer, AI, Pay, Trust, Resource, IDE, and website status are not proven against the new remote network.
- Real `.env.deploy` is not present locally; only env templates are present.

Remote deployment state:

- `make host-key-audit` on 2026-07-04 failed for all four nodes: `ssh-keyscan returned no keys` and strict SSH closed the connection.
- `remote-smoke-test` evidence generated at `2026-07-04T09:59:11.696Z` failed across public RPC, EVM RPC, REST, gRPC, faucet, indexer, explorer, AI, and Web4 checks due endpoint timeouts.
- This is not public proof.

Current blockers:

- Remote SSH is not currently usable for the four deployment nodes from this machine.
- Public service endpoints time out, so they cannot prove new-chain readiness.
- Real deploy env values and secrets are not available in a committed-safe form.

Largest real gap that can still be advanced in-repo:

- Make remote blocker diagnostics precise enough to distinguish host-key mismatch, SSH service unreachable/closed, and public endpoint timeout states, then keep `PROJECT_STATE.md` and `NEXT_ACTION.md` current after each verification run.
