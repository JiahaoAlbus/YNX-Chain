# Data Fabric Unit Economics

No production cost, revenue, free-tier, subsidy, utilization or active-user
measurement is currently evidenced. This document intentionally provides no
invented unit cost or margin.

## Required accounting model

Track the following by source version, region and time window:

- PostgreSQL storage, IOPS, backup/PITR and egress cost;
- JetStream storage, replicas, ingress/egress and operational cost;
- observability, alerting, incident and support cost;
- signed producer requests, delivered events, replayed events and active
  tenants; and
- product-approved price/fee schedules and Ledger postings.

The unit-cost denominator must be an observed delivered event or active tenant,
not a fabricated user total. Published product fees require pre-use consent,
bounded amount, schedule version, revenue-recognition boundary and immutable
Ledger evidence. Capacity and cost inputs remain external until an approved
Testnet environment supplies them.
