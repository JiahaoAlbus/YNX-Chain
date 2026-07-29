# Treasury Policy Candidate v1

Status: local observation and simulation candidate. No Treasury transfer, rebalance, market support, custody, counterparty, or external asset action is enabled.

## Authoritative snapshot

The only recovered consensus Treasury account is `ynx_protocol_resource_treasury`, funded by disclosed Resource Market protocol fees. It maps to `development_public_goods`. The following required buckets are returned as zero and `not_configured` until direct evidence exists:

- stable reserve;
- validator runway;
- insurance;
- liquidity budget;
- provider obligations;
- emergency reserve.

ABCI `GET /treasury/snapshot` and BFT Gateway `GET /treasury/snapshot` expose exact configured account balances, block-height freshness, candidate allocation limits, coverage gaps, and fail-closed execution flags. A successful response is not custody proof, an attestation, or approval to spend.

## Candidate controls

- seven-day governance timelock;
- explicit bucket and allocation limits;
- transfers disabled until a real multisig/governance authority exists;
- no secret market or price support;
- no leverage or rehypothecation;
- no unreported counterparty exposure;
- user and provider assets remain outside Treasury unless a separately approved protocol contract explicitly places them there.

The current configured balance can breach candidate allocation limits because only one bucket exists. The API reports this rather than silently treating an incomplete Treasury as compliant.

## Stress and runway

`ynx-treasury-sim` applies per-bucket initial shocks, then monthly revenue and obligations through a deterministic disclosed waterfall. It reports the first shortfall month instead of assuming new funding. Inputs are user-supplied estimates with `asOf`; output is not live Treasury authority or a forecast.

```bash
go run ./cmd/ynx-treasury-sim -input economics/examples/treasury-stress.json
go test ./internal/economics -run Treasury
```

Before activation, YNX still needs governed accounts or contracts for every configured bucket, custody and counterparty evidence, conflict disclosure, public transaction/event history, budget approvals, emergency exit, backup/restore drill, and Explorer/Monitor integration.
