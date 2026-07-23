# YNX Developer Guide

| Metadata | Value |
| --- | --- |
| Version | 0.1.0-candidate |
| Effective date | 2026-07-23 |
| Evidence source commit | TBD |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-23 |
| Superseded version | None |
| Canonical | `https://ynxweb4.com/developer` |

## Overview

YNX Testnet is an EVM-compatible Layer-1 with native YNXT and support for smart
contracts, ERC-20 tokens, NFTs, and decentralized applications. This guide covers
the complete developer workflow from setup to deployment.

## Network identity

| Field | Value |
| --- | --- |
| Network | YNX Testnet |
| Native Testnet asset | YNXT |
| EVM chain ID | `6423` / `0x1917` |
| Comet/Cosmos chain ID | `ynx_6423-1` |
| Native decimals | 18 |

## Quick start

### 1. Get Testnet YNXT

Visit the faucet:
```
https://faucet.ynxweb4.com
```

Provide your wallet address to receive Testnet YNXT for gas fees.

See `docs/developers/FAUCET_GUIDE.md` for details.

### 2. Connect your wallet

Add YNX Testnet to MetaMask:

```javascript
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '0x1917',
    chainName: 'YNX Testnet',
    nativeCurrency: { name: 'YNXT', symbol: 'YNXT', decimals: 18 },
    rpcUrls: ['https://evm.ynxweb4.com'],
    blockExplorerUrls: ['https://explorer.ynxweb4.com']
  }]
});
```

See `docs/ecosystem/METAMASK_INTEGRATION.md` for details.

### 3. Deploy your first contract

Using Remix (browser-based):

1. Open [Remix IDE](https://remix.ethereum.org)
2. Create a new Solidity file
3. Compile the contract
4. Select "Injected Provider - MetaMask" environment
5. Ensure MetaMask is connected to YNX Testnet
6. Deploy

See `docs/developers/QUICKSTART_REMIX.md` for details.

## Development frameworks

### Hardhat

Install and configure:

```bash
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
npx hardhat init
```

Add YNX Testnet to `hardhat.config.js`:

```javascript
module.exports = {
  solidity: "0.8.20",
  networks: {
    ynxTestnet: {
      url: "https://evm.ynxweb4.com",
      chainId: 6423,
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};
```

Deploy:

```bash
npx hardhat run scripts/deploy.js --network ynxTestnet
```

See `docs/developers/QUICKSTART_HARDHAT.md` for details.

### Foundry

Install Foundry:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Configure `foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]

[rpc_endpoints]
ynx_testnet = "https://evm.ynxweb4.com"
```

Deploy:

```bash
forge create --rpc-url ynx_testnet \
  --private-key $PRIVATE_KEY \
  src/MyContract.sol:MyContract
```

See `docs/developers/QUICKSTART_FOUNDRY.md` for details.

## JSON-RPC API

YNX Testnet supports standard Ethereum JSON-RPC methods:

### Core methods

- `eth_blockNumber`: Get latest block number
- `eth_getBalance`: Get account balance
- `eth_getTransactionByHash`: Get transaction details
- `eth_call`: Execute read-only call
- `eth_estimateGas`: Estimate gas for transaction
- `eth_sendRawTransaction`: Broadcast signed transaction
- `eth_getLogs`: Get event logs

### WebSocket support

```javascript
const Web3 = require('web3');
const web3 = new Web3('wss://ws.ynxweb4.com');

web3.eth.subscribe('newBlockHeaders', (error, blockHeader) => {
  console.log('New block:', blockHeader.number);
});
```

See `docs/developers/RPC_REFERENCE.md` for complete API documentation.

## Smart contract development

### Solidity version

YNX Testnet supports Solidity 0.8.x. Use the latest stable version for security
and features.

### ERC standards

Supported token standards:
- **ERC-20**: Fungible tokens
- **ERC-721**: Non-fungible tokens (NFTs)
- **ERC-1155**: Multi-token standard
- **ERC-2981**: NFT royalty standard

### Best practices

- Use OpenZeppelin contracts for battle-tested implementations
- Enable optimizer in compiler settings
- Write comprehensive tests before deployment
- Verify contracts on the block explorer after deployment
- Use upgradeable patterns (proxy) for production contracts
- Implement access control and emergency pause mechanisms
- Follow security best practices (reentrancy guards, overflow checks)

## Contract verification

Verify your deployed contracts on the YNX Testnet explorer:

```bash
# Hardhat
npx hardhat verify --network ynxTestnet <contract-address> <constructor-args>

# Foundry
forge verify-contract <contract-address> \
  src/MyContract.sol:MyContract \
  --chain-id 6423 \
  --constructor-args $(cast abi-encode "constructor(uint256)" 42)
```

See `docs/developers/CONTRACT_VERIFICATION.md` for details.

## SDKs and libraries

### JavaScript/TypeScript

```bash
npm install ethers web3
```

```javascript
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('https://evm.ynxweb4.com');
const balance = await provider.getBalance(address);
```

See `docs/developers/SDK_JS.md`.

### Python

```bash
pip install web3
```

```python
from web3 import Web3
w3 = Web3(Web3.HTTPProvider('https://evm.ynxweb4.com'))
balance = w3.eth.get_balance(address)
```

See `docs/developers/SDK_PYTHON.md`.

### Go

```go
import (
    "github.com/ethereum/go-ethereum/ethclient"
)

client, _ := ethclient.Dial("https://evm.ynxweb4.com")
balance, _ := client.BalanceAt(context.Background(), address, nil)
```

## Testing

### Local development

Use Hardhat Network or Anvil (Foundry) for local testing:

```bash
# Hardhat
npx hardhat node

# Foundry
anvil
```

### Testnet deployment

Deploy to YNX Testnet before Mainnet:

1. Test all contract functions
2. Verify gas costs are acceptable
3. Test integration with frontend
4. Conduct security review
5. Monitor for unexpected behavior

## Gas and fees

- **Gas token**: YNXT
- **Gas price**: Dynamic; query `eth_gasPrice`
- **Block gas limit**: Check current network parameters
- **Optimization**: Use gas-efficient patterns, avoid loops over unbounded arrays

## Block explorer

View transactions, contracts, and addresses:

```
https://explorer.ynxweb4.com
```

Features:
- Transaction lookup
- Contract source verification
- Token tracking
- Address activity
- Network statistics

## Oracles and data feeds

YNX Testnet supports oracle integrations for off-chain data. See
`docs/bridge/BRIDGE_ORACLE_DATA_FABRIC.md` for architecture and provider
integration guidelines.

**Note**: Testnet price feeds may use mock data; production feeds require
approved oracle providers.

## Subgraphs and indexing

For complex queries, consider running a Graph Protocol node or custom indexer.
See `docs/indexer/` for indexer deployment and query patterns.

## Security considerations

- **Private key management**: Never commit private keys; use environment variables
- **Testnet vs Mainnet**: Testnet assets have no value; do not use Mainnet keys
  on Testnet
- **Smart contract audits**: Production contracts should be audited by qualified
  security firms
- **Reentrancy**: Use OpenZeppelin's `ReentrancyGuard`
- **Integer overflow**: Use Solidity 0.8+ built-in checks or SafeMath
- **Access control**: Restrict privileged functions to authorized addresses

## Rate limits

Public RPC endpoints may have rate limits. For production applications:

- Run your own node
- Use a dedicated RPC provider
- Implement request caching and batching
- Monitor API usage

## Testnet limitations

- **Resets**: Testnet may be reset; do not rely on persistent state
- **Uptime**: Testnet availability is not guaranteed
- **Performance**: Testnet may have different performance characteristics than
  Mainnet
- **Value**: YNXT has no monetary value

## Mainnet migration

Before deploying to Mainnet:

1. Complete security audit
2. Verify all dependencies and external calls
3. Test upgrade and emergency procedures
4. Document contract addresses and deployment parameters
5. Prepare incident response plan
6. Verify legal and compliance requirements
7. Announce deployment and contract addresses publicly

## Community and support

- **Documentation**: `https://ynxweb4.com/docs`
- **GitHub**: Issues and pull requests
- **Discord/Telegram**: Developer community (links TBD)
- **Stack Overflow**: Tag `ynx-chain`

## Additional resources

- [Getting Started](docs/developers/GETTING_STARTED.md)
- [Faucet Guide](docs/developers/FAUCET_GUIDE.md)
- [Contract Verification](docs/developers/CONTRACT_VERIFICATION.md)
- [SDK Release Integrity](docs/developers/SDK_RELEASE_INTEGRITY.md)
- [Wallet Integration](docs/ecosystem/WALLET_INTEGRATION_GUIDE.md)
- [Product Architecture](docs/ecosystem/PRODUCT_ARCHITECTURE.md)

## Change log

- 0.1.0-candidate (2026-07-23): Initial comprehensive developer guide covering
  setup, frameworks, RPC API, contract development, verification, SDKs, testing,
  gas, explorer, security, and Mainnet migration.
