# faucet

`ynx-faucetd` is the deployable YNX Testnet faucet backend. It validates YNX/EVM addresses, requires `FAUCET_PRIVATE_KEY` from env, applies per IP/address rate limits, writes a JSONL request log, and submits funding requests to the YNX Chain RPC.

Verify locally:

```bash
make faucet-check
```
