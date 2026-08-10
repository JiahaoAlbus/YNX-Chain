# YNX Data Fabric Unit Economics

## Current truth

There is no measured per-active-user or per-event production cost because no staging/public deployment, broker, warehouse, tracing backend, support operation or third-party provider contract exists. Revenue is zero and no subsidy, margin or sustainability claim is approved.

## Cost model to measure

Monthly platform cost equals compute, transactional database, broker, object/backup storage, warehouse ingestion/query, observability, egress, security scanning, support and incident overhead. Attribute shared costs using measured event volume, retained bytes, reconciliation calls and query compute rather than arbitrary equal allocation.

Required unit outputs:

- cost per accepted event and per million events;
- cost per active product account;
- cost per journal entry and reconciliation run;
- retained storage cost per account-month by retention class;
- provider/API cost and free-tier exhaustion point;
- support and incident cost per thousand active accounts;
- gross-margin candidate by disclosed service fee.

YNX revenue may include only a fee the user or product accepted in advance and the ledger separately records at its revenue-recognition boundary. Provider cost, gas, venue fee, compute/data fee, subscription, management fee and high-water-mark performance fee remain separate categories. Hidden spread, unrealized-profit fees, repeated reset fees, fake volume, guaranteed return, secret buyback and undisclosed mint/burn are prohibited.

## Scale/kill gate

Do not scale a paid Data Fabric service until measured recurring revenue covers the attributable steady-state cost with an approved reliability and support reserve. Kill or redesign a flow whose provider cost, abuse rate, reconciliation burden or support load cannot be bounded without misleading users.
