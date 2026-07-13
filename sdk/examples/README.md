# SDK examples

YNX Chain SDK examples use the public testnet by default:

- REST status: `https://rpc.ynxweb4.com/status`
- EVM JSON-RPC: `https://evm.ynxweb4.com`
- Explorer: `https://explorer.ynxweb4.com`
- Chain ID: `6423` / `0x1917`
- Native coin: `YNXT`

The canonical read-only example is implemented by `make sdk-remote-check`. It runs both clients, verifies REST and EVM identity, requires positive and closely aligned heights, and requires a live release identity. It does not fund an account, submit a transaction, or imply mainnet readiness.
