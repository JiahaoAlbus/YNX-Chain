# API Reference

Core: `GET /health`, `GET /status`, `GET /metrics`, `GET /blocks/latest`, `GET /txs/{hash}`, `GET /accounts/{address}`, `GET /validators`.

`GET /validators` returns active validator records with `address`, `moniker`, optional `host`, optional `role`, optional `peerId`, `votingPower`, and `active`. Production/testnet nodes load this from `YNX_VALIDATOR_SET`; if it is missing, the node exposes only the local default validator and remote public proof must fail multi-validator checks.

EVM JSON-RPC: `POST /evm` supports `eth_chainId`, `net_version`, `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call`, `eth_getLogs`, `eth_getBlockByNumber`, and `eth_getBlockByHash` in local devnet form.

Indexer service: `ynx-indexerd` reads the chain RPC, persists indexed blocks and transactions, resumes from the last indexed height, and exposes `GET /health`, `GET /metrics`, `POST /sync`, `GET /blocks/latest`, `GET /blocks/{height}`, `GET /txs`, and `GET /txs/{hash}` on the indexer HTTP port.

Explorer service: `ynx-explorerd` reads both RPC and indexer sources and serves the reviewer-facing Explorer web/API surface. It exposes `GET /health`, `GET /metrics`, `GET /api/summary`, `GET /api/blocks/latest`, `GET /api/blocks/{height}`, `GET /api/txs`, `GET /api/txs/{hash}`, `GET /api/accounts/{address}`, `GET /api/tokens/YNXT`, `GET /api/validators`, `GET /api/resources/{address}`, `GET /api/resource-market/analytics`, `GET /api/fees/{hash}`, and `GET /api/search?q=...`. The web UI uses the same `/api/*` endpoints and the wallet metadata reports native currency `YNXT`.

Faucet service: `ynx-faucetd` is the public faucet backend. It requires `FAUCET_PRIVATE_KEY` from env, validates YNX/EVM addresses, enforces per IP/address rate limits, writes a JSONL request log, calls the chain RPC to fund YNXT, and exposes `GET /health`, `GET /metrics`, `POST /request`, and `POST /faucet`.

Products:

- `POST /faucet`
- `POST /staking/stake`
- `GET /resources/{address}`
- `GET /resource-market/quote`
- `GET /resource-market/analytics`
- `POST /resource-market/delegations`
- `GET /resource-market/delegations/{address}`
- `POST /resource-market/rent`
- `GET /resource-market/income/{address}`
- `GET /trust/trace/{address}`
- `POST /trust/labels`
- `POST /trust/evidence`
- `GET /trust/evidence/{id}`
- `GET /trust/evidence/{id}.pdf`
- `POST /governance/requests`
- `GET /governance/requests/{id}`
- `POST /governance/requests/{id}/review`
- `POST /governance/requests/{id}/reject`
- `GET /governance/request-validity-rules`
- `GET /governance/transparency`
- `POST /trust/appeals`
- `GET /trust/appeals/{id}`
- `POST /trust/appeals/{id}/resolve`
- `POST /trust/tracking-reviews`
- `GET /trust/tracking-reviews/{id}`
- `POST /pay/intents`
- `GET /pay/intents/{id}`
- `POST /pay/invoices`
- `GET /pay/invoices/{id}`
- `POST /pay/refunds`
- `POST /pay/webhook-signatures`
- `GET /ai/stream`
- `POST /ide/compile`
- `POST /ide/deploy`
- `POST /ide/verify`
- `GET /contracts/{address}`

Verification:

```bash
make smoke-test
```

The smoke test exercises RPC health, EVM chainId, block growth, faucet funding, transfer lookup, AI streaming, Trust label/evidence/PDF export, Pay intent/invoice/refund/webhook signature, resource quote/delegation/rental/income/analytics, IDE deploy, contract verification, monitoring, indexer sync, Explorer API summary, public faucet daemon funding, and package lists. It returns non-zero on failure.

Governance and Trust request safety:

- `POST /governance/requests` stores a lawful-request intake record and classifies it as `VALID_UNDER_YNX_CHAIN_LAW`, `INSUFFICIENT_EVIDENCE`, `OUT_OF_SCOPE`, `OVERBROAD`, `ILLEGAL_OR_ABUSIVE`, `REQUIRES_GOVERNANCE_REVIEW`, `REQUIRES_USER_NOTICE`, or `REJECTED`.
- `GET /governance/request-validity-rules` returns the named Chain Law / Request Validity rules used by governance and tracking review classification. Request and tracking-review responses include `ruleIds` so a reviewer can inspect why a classification was reached.
- Native `YNXT` requests cannot directly transfer, freeze, seize, blacklist, or bypass user signatures. Illegal, overbroad, or evidence-free requests are rejected and recorded in the transparency report.
- `POST /trust/labels` records advisory-only Trust label metadata including `labelId`, `address`, `labelType`, `severity`, `riskWeightBps`, `confidenceBps`, `source`, `evidenceHash`, `expiresAt`, `reviewRequired`, `appealAvailable`, `disputeStatus`, `legalStatusUnderYnxChainLaw`, optional rejected-request reference, and `assetEffect`. `assetEffect` must remain `none_advisory_only`; labels do not freeze, seize, confiscate, transfer, or classify users as criminals.
- `POST /trust/appeals` opens an appeal record for false-positive correction or dispute review and also creates a transparency entry.
- `POST /trust/appeals/{id}/resolve` records reviewer, decision, updated status, and resolution reason. Decisions include `UNDER_REVIEW`, `NEEDS_MORE_EVIDENCE`, `ACCEPTED`, `REJECTED`, `LABEL_REMOVED`, and `LABEL_REDUCED`; accepted/removal/reduction decisions add corrective Trust labels rather than freezing or moving funds.
- `POST /trust/tracking-reviews` records purpose-limited tracking review metadata: requester, subject, purpose, query type, scope, evidence, institutional/sensitive flags, minimum-necessary status, confidence, expiry, classification, and appeal path. Overbroad, evidence-free, sensitive-inference, low-confidence punitive, or audit-bypass tracking requests are rejected or routed to review.
- `GET /governance/transparency` returns the locally persisted transparency report entries and counts. Remote public proof must use the public endpoint, not localhost.
