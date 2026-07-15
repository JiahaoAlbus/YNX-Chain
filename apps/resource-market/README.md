# YNX Resource Market

Standalone capacity product for balances, staking evidence, delegation, rental, sponsored pools, fee quotes, income history, policy, expiry, revocation and disputes.

```sh
YNX_RESOURCE_MARKET_DEV_HEADER_AUTH=1 go run ./apps/resource-market
```

The store defaults to `tmp/resource-market/state.json`. Trusted headers are disabled by default and require the explicit development flag above. Non-development ingress uses server-only `YNX_RESOURCE_MARKET_SESSIONS_JSON` and the accepted Wallet session adapter. Sponsorship and every other record move bounded resource capacity only; they do not move YNXT or any user asset.
