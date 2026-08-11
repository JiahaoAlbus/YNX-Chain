# DEX candidate evidence

`public-web-api-wallet-2026-08-11.json` proves the bounded public Web, read API and same-origin Wallet Gateway deployment, exact release identity, mobile guest-mode rendering and a 1,000-request/64-concurrency read-path probe. It explicitly records that no verified market source, indexed pool or asset execution is available; it is not a swap or liquidity proof.

`current-public-state-candidate-2026-08-10.json` is local candidate evidence produced from an integrity-checked copy of the public state at height 931436. Four independent application instances committed the same six DEX actions, reached the same AppHash and durable-state digest, rejected an expired swap, and restored identical state after restart.

The capacity slice performs 400 exact concurrent committed-state reads with 25 local workers after restart. Its class is deliberately recorded as `local-one-process-current-public-state-copy-not-public-slo`: it is useful regression and shared-use evidence, but is not a public availability, multi-host, sustained-load, or million-user claim.

The chain-native market cutover remains pending until the protected validator migration and DEX asset/pool/action gates pass. That pending market work does not negate the separately proven public Web/API/Gateway surfaces.
