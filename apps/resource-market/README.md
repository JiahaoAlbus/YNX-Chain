# YNX Resource Market

Standalone capacity product for balances, staking evidence, delegation, rental, sponsored pools, fee quotes, income history, policy, expiry, revocation and disputes.

```sh
YNX_RESOURCE_MARKET_DEV_HEADER_AUTH=1 go run ./apps/resource-market
```

The store defaults to `tmp/resource-market/state.json`. Trusted headers are disabled by default and require the explicit development flag above. The Web product consumes the accepted YNX DApp Connect SDK for EIP-6963 discovery and EIP-1193 account connection, prefers YNX Wallet, supports MetaMask as a standard fallback, and keeps guest market education available without login. It never creates a local or canned Product Session.

Standard Wallet connection and private Resource authorization are separate. Connecting an approved `0x...` account on `0x1917` does not unlock provider actions, private orders, settlement, or legacy session routes. Those surfaces remain fail closed until a separately accepted and deployed Product Session v2 authority exists.

Configure the central HTTPS Gateway with `YNX_CENTRAL_GATEWAY_URL` and the registered client ID through `YNX_RESOURCE_MARKET_CLIENT_ID`. Until the registry and authority routes are merged and deployed, quotes and signed intents fail closed. Sponsorship moves bounded capacity only. A quote, signed intent, or authority acceptance is never reported as asset settlement without separate authoritative evidence. Recovery operators can inspect or restore the atomic `.bak` store with `go run ./apps/resource-market/cmd/recover`.
