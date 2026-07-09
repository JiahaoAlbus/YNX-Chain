# Testnet Acceptance Report

Before public deployment: local smoke test must pass.

Current local smoke coverage includes RPC health, EVM chainId, block height increase, faucet tx, transfer tx, explorer lookup, AI streaming, Trust trace, Trust label, Trust evidence JSON, Trust evidence PDF export, Pay intent, Pay invoice, Pay refund record, Pay webhook HMAC signature, resource quote, resource delegation, resource rental, resource income, resource analytics, IDE deploy, contract verification, monitoring, indexer sync and resume, Explorer API summary, public faucet daemon funding with rate-limit/request-log checks, package generation output, and main readiness package file lists.

After public deployment: `ENV_FILE=.env.deploy make remote-smoke-test`, `ENV_FILE=.env.deploy make verify-testnet`, and `ENV_FILE=.env.deploy make public-proof` must pass against public endpoints. The evidence must include real public RPC health, EVM chainId, block height increase, active validator set, faucet tx, explorer URL lookup for that tx, AI/Web4 health, Trust trace, Pay object, Resource quote, IDE compile or deploy proof, Anti-Illegal Request rejection, Request Validity rule registry, governance request lookup/review/reject, Trust appeal lookup/resolution, anti-unreasonable tracking review, transparency report counts, monitoring status, backup result, commit hash, deployment timestamp, package generation output, rollback notes, and known limitations.

The current public `ynxweb4.com` endpoints must not be counted as new-chain proof while they report `ynx_9102-1` or fail to expose the new `YNXT` chain identity.
