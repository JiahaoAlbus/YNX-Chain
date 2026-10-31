# SDK examples

YNX Chain SDK examples use the public testnet by default:

- REST status: `https://rpc-testnet.ynxweb4.com/status`
- EVM JSON-RPC: `https://rpc-testnet.ynxweb4.com`
- Explorer: `https://explorer.ynxweb4.com`
- Chain ID: `6423` / `0x1917`
- Native coin: `YNXT`

`node sdk/examples/testnet-endpoints.mjs` prints the typed endpoint configuration without making a network request. JavaScript consumers can import `getTestnetEndpoints()` from the SDK and pass `nativeRest` and `evmJsonRpc` separately to `YNXClient`. The reviewed, bundled endpoint authority currently selects the new `rpc-testnet`/`faucet-testnet` locations for the active profile and checks its expiry on every selection. `testnetEndpointProfiles.candidate` describes those locations; `legacy` remains an explicit compatibility profile, not automatic write failover. An expired or invalid bundled authority blocks selection until a new reviewed release is issued. The same resolved defaults feed the JavaScript and Python remote SDK checks. Existing constructors and wallet add/switch payloads remain compatible.

The generated JSON counterpart is `configs/testnet-endpoints.json`. Run `make testnet-endpoint-config-check` to reject drift against the source migration manifest. gRPC retains its separate TLS authority; WebSocket is explicitly unconfigured, not an invented HTTP URL conversion. See `docs/operations/TESTNET_ENDPOINT_MIGRATION.md` for activation and rollback gates.

SDK address helpers convert the same account between canonical EVM `0x...` and checksummed YNX `ynx1...` representations. This is a reversible display/input conversion, not a second account. EVM JSON-RPC and MetaMask continue to use `0x...`.

The canonical read-only example is implemented by `make sdk-remote-check`. It runs both clients, verifies REST and EVM identity, requires positive and closely aligned heights, and requires a live release identity. It does not fund an account, submit a transaction, or imply mainnet readiness.

`make sdk-release-package` creates deterministic local JavaScript and Python artifacts plus an unpublished canonical manifest. `make sdk-release-integrity-check` verifies digest, archive, detached-signature, and clean-consumer boundaries. These commands do not publish either package registry.

The JavaScript SDK also provides a metadata-bound EIP-1193 add/switch helper. It never requests wallet accounts or submits transactions; `make wallet-integration-check` verifies its bounded provider method sequence and failure behavior.
