# @ynx-chain/sdk

Dependency-free TypeScript/JavaScript client for read-only YNX Testnet status, strict JSON-RPC, `ynx1` address conversion, and bounded EIP-1193 network selection. It does not hold Wallet secrets, create balances, submit transactions, or reinterpret Wallet/Auth.

Requires Node.js 18 or later. The package is an unsigned Testnet SDK candidate and is not published to a public npm registry.

```ts
import { proveYNXTestnetRPC, ynxPublicEndpoints } from "@ynx-chain/sdk";

const result = await proveYNXTestnetRPC(ynxPublicEndpoints.rpcUrl);
console.log(result);
```

Transport consumers can use `ynxErrorCodes` and `classifyYNXHTTPFailure`. An
HTTP 404 is `ACCOUNT_NOT_FOUND` only when the caller marks the operation as an
account lookup and the body carries exact account-absence semantics. Timeouts,
TLS validation, malformed responses, wrong-chain responses, unavailable RPC,
and other HTTP failures remain distinct. SDK requests make one bounded attempt
and do not retry implicitly.

`FetchOptions.signal` accepts a browser or Node `AbortSignal`. Caller
cancellation is `TRANSPORT_CANCELLED`, while the SDK deadline remains
`TRANSPORT_TIMEOUT`. A valid JSON-RPC error is `JSON_RPC_ERROR` with its numeric
`rpcCode`; malformed IDs, result envelopes, or error objects are
`MALFORMED_RESPONSE`.

Run `npm test`, then `node examples/real-testnet-read.mjs`. The example fails closed if the public endpoint is unavailable, returns invalid JSON-RPC, or identifies any chain other than `0x1917`.
