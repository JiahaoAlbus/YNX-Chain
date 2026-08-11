# DEX candidate evidence

`native-public-lifecycle-2026-08-11.json` is the authoritative public YNX Testnet market lifecycle record. It identifies the active chain and DEX releases, issuer and trader accounts, the `ynx-usd-test` asset, the `dex_ynxt_yusdt` pool, seven committed transactions and their block references. The committed actions cover asset creation and transfer, pool creation, add/remove liquidity, exact-input swap and exact-output swap. Its final observation confirms the public Indexer has one pool, two swaps and two candle buckets sourced from chain-native state. No private key or seed is retained in the evidence.

`chain-native-four-node-rollout-2026-08-11.json` records the protected four-node binary rollout. Every node runs the same release and binary digest, persistent storage is healthy, all three followers report zero replication failures, and each follower's last completed authoritative snapshot matches its source. Heights are intentionally recorded as asynchronous observations and are not represented as simultaneous equality. The same record contains a 1,000-request, 64-concurrency mixed chain-read probe from loopback and a separate 1,000-request public-TLS probe from an independent validator host.

`native-market-capacity-2026-08-11.json` records two 1,000-request, 64-concurrency DEX read probes after native-market activation: schema-validated loopback traffic and public TLS traffic from an independent Singapore validator host. Both completed with 1,000 successes and zero failures. This is bounded release evidence, not a sustained million-user capacity claim.

`public-web-api-wallet-2026-08-11.json` proves the bounded public Web, read API and same-origin Wallet Gateway deployment, exact release identity, mobile guest-mode rendering and a 1,000-request/64-concurrency read-path probe. It explicitly records that no verified market source, indexed pool or asset execution is available; it is not a swap or liquidity proof.

That earlier record remains unchanged as historical evidence for the pre-market release. Its false market flags were superseded by the later native lifecycle and rollout records above; evidence is not rewritten after a release changes.

`current-public-state-candidate-2026-08-10.json` is local candidate evidence produced from an integrity-checked copy of the public state at height 931436. Four independent application instances committed the same six DEX actions, reached the same AppHash and durable-state digest, rejected an expired swap, and restored identical state after restart.

The older candidate capacity slice performs 400 exact concurrent committed-state reads with 25 local workers after restart. Its class is deliberately recorded as `local-one-process-current-public-state-copy-not-public-slo`: it is useful regression evidence, but it is not the public capacity evidence listed above.

The chain-native market cutover is complete for the bounded public Testnet release. It does not establish mainnet activation, production liquidity, an independent smart-contract audit, a production-signed desktop/mobile Wallet transaction, or an immutable app-store artifact.
