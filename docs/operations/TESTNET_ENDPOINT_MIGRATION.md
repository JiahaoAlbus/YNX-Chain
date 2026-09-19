# Testnet endpoint migration

This migration preserves the existing YNX Testnet: EVM chain ID `6423` (`0x1917`), native asset `YNXT`, genesis, block history, balances, validators and contract addresses do not change.

## Target and compatibility

- Target RPC host: `https://rpc-testnet.ynxweb4.com`
- Existing compatible RPC hosts: `https://rpc.ynxweb4.com` and `https://evm.ynxweb4.com`
- Target Faucet host: `https://faucet-testnet.ynxweb4.com`
- Existing compatible Faucet host: `https://faucet.ynxweb4.com`
- Explorer target under evaluation: `https://explorer-testnet.ynxweb4.com`; existing history links remain on `https://explorer.ynxweb4.com`
- Reserved future Mainnet hostname: `https://rpc-mainnet.ynxweb4.com`; Mainnet is disabled and has no assigned chain ID in this repository.

The deployment package adds Testnet aliases to the existing reverse-proxy services. It does not redirect JSON-RPC, create a chain, alter state, or publish Mainnet. Faucet aliases share the same process, durable admission database, funding account and quota state.

## Activation gate

1. Preserve the current ingress files and the deployed release identity.
2. Point the new Testnet DNS records at the existing controlled ingress, not a generic website deployment.
3. Review the alias-only ingress change with `YNX_MAINNET_ENABLED=false`. Do not run the full deployment script merely to activate aliases; that script has wider deployment effects and needs separate authorization.
4. Verify TLS, JSON-RPC POST, REST paths, CORS and any required WebSocket path separately.
5. Run the read-only comparison below using an existing mined transaction and an existing contract address verified against the deployment records. Do not create either sample just for this check.
6. Separately collect block-growth/native-REST evidence, transport/CORS evidence, shared Faucet admission/quota evidence and Wallet/consumer regression results. Health metadata alone cannot prove the two aliases share durable admission state.
7. Only after all applicable gates pass may the coordinator authorize consumer migration and a reviewed activation-schema change. The current candidate manifest and validator intentionally require every activation flag to remain false; editing a flag alone is not a supported activation procedure.

```sh
node scripts/verify/testnet-endpoint-migration-check.mjs --live \
  --transaction <existing-mined-transaction-hash> \
  --contract <existing-deployed-contract-address> --explorer --transports
```

Replace the placeholders before running. `--explorer` explicitly checks the candidate Explorer alias without enabling it; omit it when that alias is out of scope. If `--transaction` is omitted, the first transaction in the comparison block is used if present. An empty block is not historical-transaction evidence. `--contract` is required for a complete read-only comparison: matching empty EOA bytecode is not contract-preservation evidence.

The live check compares both RPCs two blocks below the lower current tip: chain ID, network ID, block number/hash and transaction list, plus balance, nonce and code for the configured proof address. When both aliases return the same explicit `only latest/pending state is supported` capability error for historical state, the verifier records `historicalStateUnsupported=true` and compares those three state reads at `latest`; one-sided support, different errors, or any other historical-state failure is rejected. Historical block and transaction checks still use the confirmed height. This confirmation depth is not an irreversible-consensus-finality claim. It validates a mined transaction against its containing block and compares nonempty contract code. Faucet health must identify the same build, paths and quota policy. Optional Explorer checks validate chain, indexer and build identity. JSON HTTP requests include a 10-second header-and-body deadline, a 2 MiB streamed response limit and no redirects or retries.

`--transports` additionally compares native REST `/status` identity and `/blocks/<height>` history against the EVM block, verifies HTTP CORS preflights for RPC and Faucet, then waits three seconds and requires both RPCs to advance without changing the comparison block. A slow or paused chain fails that bounded observation; retry this read-only check later, never start or reset the chain to make it pass. gRPC remains on its existing authority, and no WebSocket URL is invented: those applicable transport gates remain explicit in `remainingGates`.

Output `readOnlyComparisonVerified=true` covers only that read-only subset; `publicVerified` always remains false, with `remainingGates` enumerated. Missing transaction/contract samples produce exit code 2; invalid evidence or request failures exit nonzero. A zero exit code is **not** full migration acceptance. Running without `--live` checks local candidate configuration/template text only, not DNS, generated ingress validity or deployed behavior. Unit tests use fixtures, not official Sandbox or public alias acceptance.

## Rollback

Restore the backed-up ingress configuration, reload the proxy, and return DNS to the previous target. Keep the legacy hostnames and consumer defaults active. Do not delete Faucet admission data, chain data, indexes, blocks or contracts. If the aliases are unhealthy, leave all `publicVerified` fields false and do not migrate clients.

## External inputs still required

The standalone, two-host candidate and precise rollback procedure are in
[`deploy/testnet-alias-only`](../../deploy/testnet-alias-only/README.md).
Choose the proxy already serving the current ingress; native validation on the
target host and certificate checks remain mandatory. No consumers are activated.

- Authority to change DNS for the three Testnet aliases.
- Authority to install/reload the controlled ingress configuration and issue certificates.
- Confirmation of whether the Explorer alias should be activated after RPC and Faucet, or remain only a reserved candidate.

## Credential-independent checkpoint (2026-09-19)

Branch: `codex/weekly-v3-network-20260919`. Alias-template foundation checkpoint: `f6332d54369dd325fd5c93292013cb80aced4d82`. The verifier-hardening commit following that checkpoint only changes the verifier, its tests and this runbook. To inspect/recover either version, create a separate worktree at the selected commit; do not reset another owner's checkout. Neither commit represents an ingress deployment.

Verification at approximately 09:02 UTC:

- `make testnet-endpoint-migration-check`: 27 local fixture tests passed, candidate configuration passed.
- `make chainlist-candidate-check`, `node --check scripts/verify/testnet-endpoint-migration-check.mjs`, `git diff --check`: passed.
- `node scripts/verify/testnet-endpoint-migration-check.mjs --live`: failed closed with HTTP 404 from `https://rpc-testnet.ynxweb4.com`; no migration acceptance was emitted.
- Read-only legacy Explorer `/health`: chain 6423, YNXT, healthy indexer, height 1628489, build `e12f048596bed823d4f4e8be4ff5f0434e0b1f55`. This is a point-in-time legacy-host observation, not evidence for the new Explorer alias.

No DNS/ingress changes, Faucet funding requests, signatures, trading requests, Mainnet activation or chain-state changes were performed. Official securities Sandbox verification still requires credentials and remains outside this network checkpoint. The coordinator owns deployment authorization and the remaining cross-product acceptance gates.
