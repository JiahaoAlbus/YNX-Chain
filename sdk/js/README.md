# @ynx-chain/sdk

Dependency-free TypeScript/JavaScript client for read-only YNX Testnet status, strict JSON-RPC, `ynx1` address conversion, and bounded EIP-1193 network selection. It does not hold Wallet secrets, create balances, submit transactions, or reinterpret Wallet/Auth.

Requires Node.js 18 or later. The package is an unsigned Testnet SDK candidate and is not published to a public npm registry.

```ts
import { proveYNXTestnetRPC, ynxPublicEndpoints } from "@ynx-chain/sdk";

const result = await proveYNXTestnetRPC(ynxPublicEndpoints.rpcUrl);
console.log(result);
```

Run `npm test`, then `node examples/real-testnet-read.mjs`. The example fails closed if the public endpoint is unavailable, returns invalid JSON-RPC, or identifies any chain other than `0x1917`.
