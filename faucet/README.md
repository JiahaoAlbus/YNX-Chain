# faucet

`ynx-faucetd` is the deployable YNX Testnet faucet backend. It validates YNX/EVM addresses, requires a private Core authority token in authoritative mode, applies per-address and wider per-IP limits, writes a JSONL request log, and submits durable request identities to YNX Chain Core.

The authoritative service retains every admitted request identity so retries and lost acknowledgements cannot create a second payment. `/health` and `/metrics` report the retained count, configured `YNX_FAUCET_MAX_ADMISSIONS` limit and remaining capacity. Exhaustion makes health not ready for new users while old request IDs remain recoverable; increase the limit with the same database rather than deleting or copying it.

The authoritative admission database and quotas are local bbolt state. Run one active Faucet process against it. Multi-active replicas and cross-instance rate limits are not supported; use the reported `stop-drain-start` deployment strategy and preserve the admission path across upgrades and rollback.

Verify locally:

```bash
make faucet-check
```
