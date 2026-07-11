# docker

This directory is part of the YNX Chain engineering surface. It is intentionally separated so runtime code, deployment assets, and review packages do not collapse into the website repository.

`docker-compose.yml` runs `ynx-chaind`, `ynx-indexerd`, `ynx-explorerd`, `ynx-faucetd`, `ynx-ai-gatewayd`, `ynx-payd`, `ynx-trustd`, Prometheus, and Grafana for local operations review. The indexer, explorer, and faucet expose their existing RPC-backed surfaces on ports `6426` through `6428`. The AI Gateway exposes its authenticated surface on `6429`; Pay owns authenticated merchant operations on `6430`; Trust owns authenticated lineage, advisory risk, evidence, appeal, tracking, Request Validity, and Transparency operations on `6431`. Canonical Pay and Trust state remains persistent in the chain runtime.

```bash
MONITORING_ADMIN_PASSWORD=local-dev-only OPENAI_API_KEY=local-provider-key AI_MODEL_NAME=local-model YNX_AI_GATEWAY_API_KEY=local-access-key YNX_AI_GATEWAY_UPSTREAM_KEY=local-ai-upstream-key YNX_PAY_MERCHANT_ID=local-merchant YNX_PAY_API_KEY=local-pay-key YNX_PAY_GATEWAY_UPSTREAM_KEY=local-pay-upstream-key YNX_PAY_WEBHOOK_SIGNING_KEY=local-webhook-key YNX_TRUST_API_KEY=local-trust-key YNX_TRUST_GATEWAY_UPSTREAM_KEY=local-trust-upstream-key docker compose -f infra/docker/docker-compose.yml up --build
```
