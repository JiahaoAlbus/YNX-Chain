# docker

This directory is part of the YNX Chain engineering surface. It is intentionally separated so runtime code, deployment assets, and review packages do not collapse into the website repository.

`docker-compose.yml` runs `ynx-chaind`, `ynx-indexerd`, `ynx-explorerd`, `ynx-faucetd`, `ynx-ai-gatewayd`, `ynx-payd`, Prometheus, and Grafana for local operations review. The indexer reads `ynx-chaind:6420`, persists its JSON database in the `ynx-indexer-data` volume, and exposes health, indexed blocks, transactions, and metrics on port `6426`. The explorer reads both RPC and indexer data and exposes web/API/metrics on port `6427`. The faucet reads RPC, enforces rate limits, writes request logs, and exposes health/metrics/request endpoints on port `6428`. The AI Gateway calls an OpenAI-compatible provider and exposes its authenticated surface on port `6429`. The Pay gateway owns merchant authentication, managed webhook signing, bounded request handling, rate limits, and redacted access audit on port `6430`, while the chain remains authoritative for persistent Pay records.

```bash
MONITORING_ADMIN_PASSWORD=local-dev-only OPENAI_API_KEY=local-provider-key AI_MODEL_NAME=local-model YNX_AI_GATEWAY_API_KEY=local-access-key YNX_AI_GATEWAY_UPSTREAM_KEY=local-ai-upstream-key YNX_PAY_MERCHANT_ID=local-merchant YNX_PAY_API_KEY=local-pay-key YNX_PAY_GATEWAY_UPSTREAM_KEY=local-pay-upstream-key YNX_PAY_WEBHOOK_SIGNING_KEY=local-webhook-key docker compose -f infra/docker/docker-compose.yml up --build
```
