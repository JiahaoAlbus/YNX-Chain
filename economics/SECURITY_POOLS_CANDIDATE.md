# Safety Module and Service Security Pools Candidate v1

Status: deterministic risk model implemented and tested locally. No pool contract, custody account, governance authority, insurance policy, deployment, reward stream, or public stake exists.

## Independent risk domains

Candidate v1 defines six isolated pools:

| Pool | Only authorized loss condition |
| --- | --- |
| Safety Module | protocol shortfall |
| Oracle | oracle failure |
| Bridge | bridge failure |
| Storage | storage failure |
| AI | AI service failure |
| Indexer | indexer failure |

An incident submitted to the wrong pool is rejected atomically. A loss can consume only that pool's insurance and voluntary stake. Uncovered loss remains explicit and cannot pull funds from another pool. Every result reports `crossPoolTransfersYnxt=0`, `recursiveRestaking=false`, and `crossServiceContagion=false`.

## Stake, insurance and exit waterfall

Stake and insurance funding must identify `external_unencumbered` as their source. Pool receipts, already-staked claims, borrowed collateral, and other encumbered sources are rejected; the candidate does not mint reusable receipt assets. Each pool has a 10,000,000 YNXT candidate stake cap.

An approved incident applies this waterfall:

1. consume the affected pool's insurance balance;
2. slash no more than 30% of that pool's then-current voluntary stake;
3. report the remaining amount as uncovered loss.

Exit requests reserve voluntary stake for 21 epochs. Claims remain slashable during cooldown: an incident reduces queued claims by the same stake-loss ratio and records the cumulative haircut. Pause blocks new stake but preserves exit request and mature fulfillment. Coverage, principal, exit amount, and recovery are never guaranteed.

## Governance boundary

Incident, pause, and unpause actions require an explicit approved decision, a SHA-256 evidence reference, and a seven-epoch candidate timelock. These are simulated inputs, not proof that YNX governance exists or approved an event. Input booleans cannot make output `mainnetReady` or `contractExecution` true.

Activation requires independently audited contracts, formal incident definitions and adjudication/appeal rules, governance and key custody, funding provenance, economic and correlated-loss stress, testnet deployment, Explorer events, migration/rollback, emergency exit, legal review, and public risk disclosures.

## Reproduce

```bash
make security-pools-candidate-check
go run ./cmd/ynx-security-pools-sim -input economics/examples/security-pools-stress.json
```

The checked scenario includes voluntary stake, recursive-stake rejection, cooldown exit, wrong-condition rejection, insurance/stake/uncovered waterfall, exit haircut, early-exit rejection, mature exit, independent Bridge loss, and Safety Module protocol-shortfall coverage.
