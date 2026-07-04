# Faucet Guide

Local chain RPC still supports `POST /faucet` for developer smoke tests. Public faucet traffic should go through `ynx-faucetd`, which requires `FAUCET_PRIVATE_KEY` from env, validates YNX/EVM addresses, rate-limits per IP/address, writes a JSONL request log, and forwards approved funding requests to the YNX Chain RPC.

Verify locally:

```bash
make faucet-check
```

Request:

```bash
curl -fsS -X POST http://127.0.0.1:6428/request \
  -H 'content-type: application/json' \
  -d '{"address":"ynx_developer"}'
```
