# YNX Exchange Integration Guide

| Metadata | Value |
| --- | --- |
| Version | 0.1.0-candidate |
| Effective date | 2026-07-23 |
| Evidence source commit | TBD |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-23 |
| Superseded version | None |
| Canonical | `https://ynxweb4.com/exchange` |

## Status

This guide addresses Testnet integration only. It is not a claim of Mainnet
availability, production custody, active liquidity, regulatory approval, or
listing commitment from any exchange.

## Network identity

| Field | Value |
| --- | --- |
| Network | YNX Testnet |
| Native Testnet asset | YNXT |
| EVM chain ID | `6423` / `0x1917` |
| Comet/Cosmos chain ID | `ynx_6423-1` |
| Native decimals | 18 |
| Symbol | YNXT |
| Type | Testnet utility token (no monetary value) |

## Integration overview

YNX Testnet supports both native YNXT transactions and EVM-compatible operations.
Exchanges can integrate using:

1. **Native path**: Cosmos SDK / CometBFT transactions for YNXT transfers
2. **EVM path**: Ethereum-compatible JSON-RPC for ERC-20 tokens and smart contracts
3. **Hybrid**: Native YNXT deposits/withdrawals plus EVM token support

## Prerequisites

- Dedicated validator or full node
- Secure key management (HSM recommended for production)
- Transaction monitoring and reconciliation systems
- AML/KYC/sanctions compliance infrastructure
- Incident response and customer support workflows

## Node setup

### Running a full node

```bash
# Initialize node
ynxd init <exchange-node> --chain-id ynx_6423-1 --home ~/.ynx-exchange

# Obtain genesis file from network coordinator
cp genesis.json ~/.ynx-exchange/config/genesis.json

# Configure seeds and persistent peers
# Edit ~/.ynx-exchange/config/config.toml

# Disable indexing if using custom database
# Edit ~/.ynx-exchange/config/config.toml: indexer = "null"

# Start node
ynxd start --home ~/.ynx-exchange
```

### Node monitoring

- **Sync state**: Verify node is caught up before processing deposits
- **Peer health**: Maintain stable peer connections
- **Block lag**: Monitor for consensus delays or stalls
- **Disk space**: Ensure sufficient storage for chain growth
- **RPC availability**: Health check JSON-RPC and native RPC endpoints

## Deposit workflow (Native YNXT)

### Generate deposit addresses

```bash
# Generate a unique address per user or use a single hot wallet with memos
ynxd keys add user-deposit-<id> --home ~/.ynx-exchange
```

**Important**: If using a single deposit address, implement memo-based
accounting to distinguish users. Cosmos SDK supports memo fields in transactions.

### Monitor incoming transactions

```bash
# Query transactions to a specific address
ynxd query txs --events "transfer.recipient=<address>" --node <rpc-endpoint>

# Or monitor blocks and parse transfer events
ynxd query block <height> --node <rpc-endpoint>
```

### Confirmation policy

- **Minimum confirmations**: 12 blocks recommended (approximately 60 seconds)
- **Finality**: CometBFT provides fast finality; confirmed blocks are not reverted
  under normal operation
- **Reorg risk**: Minimal in BFT consensus; monitor for consensus issues

### Credit user balance

Once confirmations are met and the transaction is verified:

1. Parse amount and recipient from transaction events
2. Match to user account (by address or memo)
3. Credit internal balance
4. Record transaction hash, height, and timestamp for audit

## Withdrawal workflow (Native YNXT)

### Validate withdrawal request

- Verify user has sufficient internal balance
- Check withdrawal address format (bech32 with `ynx` prefix)
- Apply withdrawal limits and AML/sanctions screening
- Deduct internal balance before broadcasting

### Broadcast transaction

```bash
# Create and sign withdrawal transaction
ynxd tx bank send <hot-wallet> <user-address> <amount>ynxt \
  --chain-id ynx_6423-1 \
  --from <hot-wallet> \
  --gas auto \
  --gas-adjustment 1.5 \
  --node <rpc-endpoint>
```

### Monitor transaction status

```bash
# Query transaction by hash
ynxd query tx <txhash> --node <rpc-endpoint>
```

Check for:
- `code: 0` (success)
- Block height and timestamp
- Events confirming transfer

### Handle failures

If a withdrawal transaction fails:
- Parse error code and message
- Refund user's internal balance if not broadcasted or rejected
- Log failure for investigation
- Retry with adjusted gas or corrected parameters

## EVM integration (ERC-20 tokens)

YNX Testnet supports Ethereum JSON-RPC. Exchanges can integrate ERC-20 tokens
using standard Ethereum tooling.

### JSON-RPC endpoint

```
https://evm.ynxweb4.com
```

(Actual endpoint provided by network coordinator)

### Web3 integration

```javascript
const Web3 = require('web3');
const web3 = new Web3('https://evm.ynxweb4.com');

// Check balance
const balance = await web3.eth.getBalance(address);

// Monitor ERC-20 transfers
const contract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
contract.events.Transfer({ filter: { to: depositAddress } }, (error, event) => {
  // Credit user balance
});
```

### Gas and fees

- **Gas token**: Native YNXT is used for EVM gas
- **Gas price**: Query `eth_gasPrice` or use EIP-1559 if supported
- **Estimation**: Use `eth_estimateGas` and apply safety margin

## Hot/cold wallet architecture

- **Hot wallet**: Online, automated withdrawals with limited funds
- **Cold wallet**: Offline, multi-sig, bulk replenishment only
- **Warm wallet**: Semi-automated, manual approval for large withdrawals
- **Reconciliation**: Daily balance checks between blockchain and internal ledger

## Fee structure

Exchanges determine their own deposit/withdrawal fees. On-chain costs include:

- **Native transfer**: Minimal (fixed fee or dynamic gas)
- **EVM transactions**: Gas cost in YNXT
- **Contract interactions**: Higher gas for complex operations

## Testnet limitations

- **No monetary value**: YNXT is a Testnet asset with no represented value
- **Reset risk**: Testnet may be reset without notice; not suitable for production
- **Liquidity**: No guaranteed orderbook depth or external liquidity
- **Custody**: Production-grade custody, insurance, and reserve proof are not claimed
- **Regulatory status**: Testnet integration does not imply regulatory approval
  for Mainnet listing

## Mainnet readiness

Before Mainnet integration, exchanges must verify:

1. **Network launch**: Official Mainnet announcement and genesis
2. **Token supply**: Final allocation, circulating supply, and vesting schedules
3. **Liquidity**: Market depth, price discovery, and volatility
4. **Custody**: Secure key management, insurance, and operational procedures
5. **Compliance**: AML/KYC, sanctions, licensing, and reporting obligations
6. **Support**: Customer service, incident response, and dispute resolution
7. **Legal review**: Token classification, listing jurisdiction, and risk disclosure

## Security checklist

- [ ] HSM or secure enclave for hot wallet signing
- [ ] Multi-signature cold wallet with offline signing
- [ ] Withdrawal velocity limits and anomaly detection
- [ ] AML/sanctions screening on deposits and withdrawals
- [ ] Transaction replay protection and nonce management
- [ ] Regular reconciliation between chain state and internal ledger
- [ ] Incident response plan for chain halts, rollbacks, or attacks
- [ ] Backup and recovery procedures for keys and database

## Support and coordination

For Testnet integration assistance:

- Genesis files and RPC endpoints: network coordinator
- Token metadata and chainlist submission: `docs/ecosystem/`
- AML/sanctions provider integration: `docs/compliance/PROVIDER_REGISTER.md`
- Technical issues: GitHub Issues or developer support channel

## Change log

- 0.1.0-candidate (2026-07-23): Initial exchange integration guide covering node
  setup, deposits, withdrawals, EVM support, custody, Testnet limitations, and
  Mainnet readiness checklist.
