# YNX Search Decision Log

## 2026-07-29 — Protected runtime source

The runtime checkpoint is `88ee867322ec11a243a483c04bab99676cc3416e`.
Evidence-only commits may advance repository HEAD, but must not be represented as
a newly deployed runtime without build and deployment evidence.

## 2026-07-29 — Observability privacy boundary

Structured logs and metrics use normalized routes and bounded status metadata.
They exclude queries, bodies, IP addresses, error messages, source snippets,
Wallet data and authorization evidence. Error responses expose a correlation ID,
not stack traces or internal paths.

## 2026-07-29 — Metrics access

`/api/metrics` is unavailable unless an operator configures its bearer reference.
Wrong or absent authorization fails closed. Central Monitor remains the authority
for durable storage, alerts, dashboards and incident linkage.

## 2026-07-29 — Capacity truth

The local benchmark is accepted as reproducible implementation evidence only.
Staging, public and production capacity remain false until measured in those exact
environments and bound to their deployed source commit.

## 2026-07-29 — External provider order

A provider-neutral contract and negative tests must exist before credentials are
requested. Missing configuration returns unavailable state. Fixtures may verify
the adapter but cannot prove provider-backed Testnet operation.

## Standing decisions

- Coverage is registered-authorized-sources-only.
- Pre-v4 governance and unreviewed data classes fail closed.
- AI retrieval rights are separate from ordinary Search rights.
- YNX is never silently corrected to Lynx.
- Vector retrieval remains candidate-disabled.
- `ynxweb4.com` is the only official YNX product domain; `huangjeo.com` remains
  Founder-only except for legitimate `mcpXX.huangjeo.com` service endpoints.
