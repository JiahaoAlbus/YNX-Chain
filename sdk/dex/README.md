# @ynx-chain/dex-sdk

Strict Testnet-only JavaScript SDK for YNX DEX quotes, deterministic routes, slippage bounds, Strategy Vault execution requests, confirmed-receipt reconciliation and API schema parsing.

```js
import { quoteExactInput, minimumOutput } from "@ynx-chain/dex-sdk";

const quote = quoteExactInput({ amountIn, tokenIn, tokenOut, pools });
const amountOutMin = minimumOutput(quote.amountOut, 50); // 0.50%
```

## Strategy Vault execution adapter

The adapter parses source-labelled Vault state, rejects stale/paused/revoked/killed/expired mandates, and builds typed exact-input, exact-output, add-liquidity, remove-liquidity, pause and emergency-exit requests. Engine requests bind the immutable engine, Vault nonce domain, current action nonce and source-state timestamp. There is no arbitrary-call builder or caller-selected output recipient.

`submitApprovedVaultRequest` accepts only an exact `dex:vault:execute` approval from canonical YNX Wallet introspection whose SHA-256 request digest, Vault, engine, nonce domain, nonce and expiry match. The caller must inject the engine transport explicitly. The SDK contains no provider, signer, key storage or automatic execution loop. Submission returns `submitted-unconfirmed`; only `reconcileVaultAction` can produce confirmed evidence after matching `ActionExecuted` and the configured confirmation depth.

`parseIndexedVaultAction` and `reconcileIndexedVaultAction` consume only the source-labelled `ynx-vault-action-v1` records produced by the confirmed Indexer. They reject Vault, nonce-domain, nonce, method/selector and provenance substitutions. Direct receipt reconciliation remains the stronger path when an exact confirmation count is required.

All amounts are raw integer token units. Callers must use only owner-reviewed chain-6423 token metadata, present every route/pool and bind requests to canonical Wallet review. `mainnet=false`, `audited=false`.
