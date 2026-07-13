# SDK examples

YNX Chain SDK examples use the public testnet by default:

- REST status: `https://rpc.ynxweb4.com/status`
- EVM JSON-RPC: `https://evm.ynxweb4.com`
- Explorer: `https://explorer.ynxweb4.com`
- Chain ID: `6423` / `0x1917`
- Native coin: `YNXT`

SDK address helpers convert the same account between canonical EVM `0x...` and checksummed YNX `ynx1...` representations. This is a reversible display/input conversion, not a second account. EVM JSON-RPC and MetaMask continue to use `0x...`.

The canonical read-only example is implemented by `make sdk-remote-check`. It runs both clients, verifies REST and EVM identity, requires positive and closely aligned heights, and requires a live release identity. It does not fund an account, submit a transaction, or imply mainnet readiness.

`make sdk-release-package` creates deterministic local JavaScript and Python artifacts plus an unpublished canonical manifest. `make sdk-release-integrity-check` verifies digest, archive, detached-signature, and clean-consumer boundaries. These commands do not publish either package registry.
