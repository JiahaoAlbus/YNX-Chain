# Dependency Acceptance

## Status

Product 30 has frozen its candidate contract at `release/integration/security-platform-contract.json`. No central dependency is marked accepted solely because a local adapter or manifest exists.

## Acceptance matrix

| Dependency | Required input | Current state | Fail-closed behavior |
| --- | --- | --- | --- |
| 01 Chain Core | validator/deploy identity, chain-state consistency, backup and rollback contract | pending | no validator or chain-state recovery claim |
| 02 Wallet/Auth | Product Session, mandate, revoke, device and mobile signing boundary | pending | no user authorization substitute |
| 13 Monitor | metrics/logs/traces schema, alert routing, on-call and status contract | pending | monitoring manifest detached; alerts inactive |
| 15 Trust | disclosure, evidence, correction and appeal contract | pending | no public disclosure automation |
| 18 Docs/Compliance | approved public claims and legal review status | pending | public security claims remain draft/candidate |
| 19 Oracle | reporter identity, provider-access metadata and incident boundary | pending | no Oracle allow policy emitted |
| 21 Bridge | signer/MPC/HSM, pause and recovery contract | pending | no Bridge allow policy emitted |
| 26 Data Fabric | canonical audit/event/ledger integrity schema | pending | local evidence is not central ledger evidence |
| 28 Website | public status, hosted artifact and SEO target ownership | pending | SEO targets are probes only; no public pass claim |
| 29 Integration | unique release contract, merge order and shared Testnet | pending | `integratedCentral=false` |
| 31 Governance | policy, timelock and emergency-control authority | pending | no automatic policy or emergency execution |

## Acceptance rule

A dependency becomes accepted only when all of the following exist:

1. named owner and source commit;
2. versioned contract/schema/event definitions;
3. expected authentication scope and environment binding;
4. positive and negative test vectors;
5. migration and rollback behavior;
6. direct test or Testnet evidence;
7. conflict resolution through Product 29 where ownership overlaps.

Partial adapters remain `candidate` or `blocked`; they are not silently treated as compatible production integrations.
