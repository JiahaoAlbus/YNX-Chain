# Faucet Guide

Local chain RPC still supports `POST /faucet` for developer smoke tests. Public faucet traffic should go through `ynx-faucetd`, which validates addresses, rate-limits per IP/address, and writes a mode-`0600` JSONL request log.

`YNX_FAUCET_UPSTREAM_MODE=authoritative` preserves the current rollback-compatible privileged RPC path. `YNX_FAUCET_UPSTREAM_MODE=bft` accepts only canonical lowercase EVM-compatible recipients, requires chain ID `6423`, derives and verifies `YNX_FAUCET_ADDRESS`, queries the exact next account nonce, signs locally, and submits only the canonical signed envelope to the loopback BFT Gateway. Supply exactly one key source: canonical `FAUCET_PRIVATE_KEY` hex or a regular mode-restricted raw 32-byte file at `YNX_FAUCET_PRIVATE_KEY_FILE`. The key must remain process-local and must never be logged or sent upstream.

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
