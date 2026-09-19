# YNX Wallet public Testnet E2E

This evidence records a real, reproducible Wallet extension flow against public YNX Testnet services from source commit `7eb0beef4f3b1199ee817441d6cc04346e511765`.

The run used a fresh disposable Microsoft Edge profile, an unpacked build from that exact source, and a newly generated test-only account. Recovery material, the vault password, private keys, signatures, and raw transactions were never written to the evidence. The external DApp was the public MetaMask test DApp at `https://metamask.github.io/test-dapp/`.

The run proved:

- Faucet request state was persisted before the one and only POST. Request `wallet_301fd86cb27e105434f7b4d8968de613d796db341584372082ed0f841782847a` was admitted once and funded 100 YNXT.
- The DApp discovered YNX Wallet through EIP-6963, received explicit account approval, read chain `0x1917`, and completed a `personal_sign` recovery check.
- Two separate 1 YNXT transfers completed with the fixed 1 YNXT fee. Both receipts have `status=0x1` and local-snapshot durability `durable`.
- After each broadcast acknowledgement, the wallet journal blocked a new send until the user invoked the read-only status check for the exact transaction hash. The status check recorded the durable receipt and released the blocker.
- A brief `-32002` visibility window occurred after the second broadcast acknowledgement. The harness queried only the exact hash until its durable receipt appeared; it did not retry the raw transaction or create a replacement.
- Page refresh restored the approved account. Offline provider access failed with `RPC_UNAVAILABLE`, then recovered after connectivity returned. A full browser restart restored the approved account and chain `0x1917`.
- Public readback ended with sender latest and pending nonce `0x2`, sender balance 96 YNXT, and receiver balance 2 YNXT.

This run validates the pending journal and recovery mechanism with 1 YNXT transfers. It does not identify or reconcile the earlier manually observed 10 YNXT transfer plus 1 YNXT fee because that historical public account or transaction hash was not available. It does not claim extension-store publication, signed native installers, Android/iOS real-device execution, consensus finality, or native production Faucet availability.

Files:

- `execution.json`: browser/provider lifecycle and transaction evidence.
- `faucet-request-journal.json`: request identity persisted before network access and the one response received.
- `public-readback.json`: later read-only Faucet and RPC state for the public identifiers.
- `checksums.json`: SHA-256 digests of the evidence files.
