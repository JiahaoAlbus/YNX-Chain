# YNX Validator Guide

| Metadata | Value |
| --- | --- |
| Version | 0.1.0-candidate |
| Effective date | 2026-07-23 |
| Evidence source commit | TBD |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-23 |
| Superseded version | None |
| Canonical | `https://ynxweb4.com/validator` |

## Status

This guide addresses the local four-validator quorum gate and operator-controlled
Testnet validator workflows. It is not a claim of permissionless validator
participation, delegated staking, active reward distribution or slashing.

## Prerequisites

- Go 1.23+
- Git
- Unix-like environment (macOS/Linux)
- At least 4 GB RAM
- Persistent storage for chain state

## Network identity

| Field | Value |
| --- | --- |
| Network | YNX Testnet |
| EVM chain ID | `6423` / `0x1917` |
| Comet/Cosmos chain ID | `ynx_6423-1` |
| Native Testnet asset | YNXT |

## Local four-validator quorum

The repository includes a deterministic local quorum gate that creates four
independent validator homes with distinct keys, generates a genesis state and
verifies consensus without external networking.

### Running the local quorum

```bash
make test-local-quorum
```

This initializes four validator directories, creates a unified genesis, starts
the validators and verifies that blocks are produced and finalized.

### Verification

Check that:
- All four validator directories exist under `.ynx-testnet/`
- Genesis `chain-id` matches `ynx_6423-1`
- Block height advances without stalls
- Validator signatures appear in commit records
- No panics or consensus failures occur

## Operator-controlled Testnet validator

Running a Testnet validator requires:

1. **Persistent host**: A stable server or VM
2. **Chain binary**: Built from the accepted source commit
3. **Genesis file**: Obtained from the operator or network coordinator
4. **Validator key**: Generated with `ynxd keys add` and backed up securely
5. **Node key**: Generated during `ynxd init`
6. **Seed/persistent peers**: Obtained from network coordinator
7. **RPC/P2P ports**: Properly configured and optionally firewalled
8. **Monitoring**: Health checks, disk, memory, block lag and peer count

### Initialize a validator node

```bash
# Initialize node home
ynxd init <moniker> --chain-id ynx_6423-1 --home ~/.ynx-validator

# Copy the network genesis file
cp genesis.json ~/.ynx-validator/config/genesis.json

# Configure seeds and persistent peers in config.toml
# Edit ~/.ynx-validator/config/config.toml

# Start the node
ynxd start --home ~/.ynx-validator
```

### Create a validator transaction

Once your node is synced:

```bash
# Create a validator keypair (if not already done)
ynxd keys add validator --home ~/.ynx-validator

# Fund the validator account (obtain YNXT from faucet or coordinator)

# Submit create-validator transaction
ynxd tx staking create-validator \
  --amount=1000000000000000000ynxt \
  --pubkey=$(ynxd tendermint show-validator --home ~/.ynx-validator) \
  --moniker="<your-moniker>" \
  --chain-id=ynx_6423-1 \
  --commission-rate="0.10" \
  --commission-max-rate="0.20" \
  --commission-max-change-rate="0.01" \
  --min-self-delegation="1" \
  --from=validator \
  --home ~/.ynx-validator
```

### Monitoring and operations

- **Health**: Check `ynxd status` for sync state and block height
- **Logs**: Monitor validator logs for errors, consensus timeouts or panics
- **Peers**: Verify peer count and connectivity
- **Disk**: Ensure sufficient space for chain growth
- **Uptime**: Track missed blocks and consensus participation
- **Backup**: Securely back up `priv_validator_key.json` and seed phrases

### Validator risks

- **Slashing**: Validator misbehavior (double-sign, unavailability) may result
  in slashing once enabled
- **Jailing**: Extended downtime can jail the validator
- **Commission**: Validator operators earn commission on delegations; this is
  not guaranteed return for delegators
- **Testnet status**: YNXT has no represented monetary value; validator
  participation does not guarantee Mainnet inclusion or rewards

## Staking and delegation

A complete staking lifecycle (delegation, rewards, unbonding, withdrawal,
commission, slashing) is under development. Current Testnet state records
validator power and delegations but does not distribute active rewards or execute
automatic slashing.

## Upgrades

Chain upgrades require coordinated validator participation. Upgrade procedures
include:

1. Monitoring for upgrade proposals and governance votes
2. Stopping the old binary at the upgrade height
3. Replacing the binary with the new version
4. Restarting the node
5. Verifying post-upgrade block production

Testnet upgrades are operator-coordinated; there is no active on-chain governance
execution at this time.

## Security practices

- Never share `priv_validator_key.json` or seed phrases
- Use hardware security modules (HSM) or remote signers for production
- Run validators behind firewalls with restricted RPC/API access
- Enable sentry nodes for DDoS protection
- Monitor for consensus anomalies and double-sign risk
- Keep validator software and dependencies updated

## Support and coordination

Testnet validator onboarding and support is operator-controlled. Contact the
network coordinator for:

- Genesis files and network parameters
- Seed/persistent peer information
- Testnet YNXT allocation
- Upgrade schedules and governance proposals
- Incident response and recovery procedures

## Mainnet readiness

No Mainnet launch is established by this Testnet guide. Mainnet validator
participation, economics, governance, slashing, rewards, and permissionless entry
require separate analysis, legal review, and public announcement.

## Change log

- 0.1.0-candidate (2026-07-23): Initial validator guide covering local quorum,
  operator-controlled Testnet setup, monitoring, risks, and upgrade coordination.
