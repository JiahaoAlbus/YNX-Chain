# @ynx-chain/dex-sdk

Strict Testnet-only JavaScript SDK for YNX DEX constant-product quotes, deterministic routes, slippage bounds, transaction request construction and API schema parsing.

```js
import { quoteExactInput, minimumOutput } from "@ynx-chain/dex-sdk";

const quote = quoteExactInput({ amountIn, tokenIn, tokenOut, pools });
const amountOutMin = minimumOutput(quote.amountOut, 50); // 0.50%
```

All amounts are raw integer token units. Callers must use only owner-reviewed chain-6423 token metadata, present every route/pool and bind requests to canonical Wallet review/signing. The SDK never holds keys, signs or submits transactions. `mainnet=false`, `audited=false`.
