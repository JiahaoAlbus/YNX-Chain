# JavaScript SDK

The dependency-free ESM client in `sdk/js` reads YNX REST status and EVM JSON-RPC without mutating chain state. It is package-ready but is not claimed as published to npm.

```js
import {YNXClient, assertYNXTestnetSnapshot} from "@ynx-chain/sdk";

const client = new YNXClient({
  restUrl: "https://rpc.ynxweb4.com",
  evmUrl: "https://evm.ynxweb4.com",
});
const snapshot = assertYNXTestnetSnapshot(await client.getChainSnapshot());
console.log(snapshot.status.height, snapshot.evmChainId);
```

The SDK also exports `ensureYNXTestnet(provider)` and `ynxTestnetAddEthereumChainParameter()` for metadata-bound EIP-1193 custom-network integration. The helper never requests an account or transaction and verifies the selected chain after add/switch.

Run `make sdk-check` for fixture-backed unit/package checks, deterministic artifact verification, and an isolated artifact-only consumer. `make sdk-remote-check` provides read-only compatibility proof against the public testnet. See `docs/developers/SDK_RELEASE_INTEGRITY.md` for the canonical manifest and optional owner-supplied detached-signature boundary.
