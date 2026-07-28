# Governance threat model

## Protected assets

Protected assets are proposal integrity, electorate snapshots, vote records, role terms, emergency-pause limits, timelock state, execution manifests, rollback evidence, the Gateway assertion key, and the availability of public governance records. User private keys, seeds, and withdrawal authority are outside Governance custody and must never enter this service.

## Trust boundaries

- Wallet and App Gateway prove account ownership, device binding, product binding, session expiry, and revocation.
- The internal Gateway assertion proves that verified identity metadata and the request body were forwarded without tampering. It does not grant a Governance role.
- Governance state grants role and object scope, enforces lifecycle policy, and records decisions.
- Protocol executors, hardware signers, chain consensus, Explorer, and Monitor are external boundaries. Local `executionHash` state is not proof that protocol execution occurred.

## Principal threats and controls

| Threat | Control |
| --- | --- |
| Single administrator captures protocol | No administrator role; pinned distributed genesis councils; later role changes require executed proposals |
| Browser session replay | Canonical App Gateway expiry/revocation plus 30-second internal assertion and nonce replay cache |
| Gateway metadata or body tamper | HMAC-SHA-256 binds method, escaped path, body hash, identity, product, timestamp, and nonce |
| Wrong product or device | Exact Governance product and device-bound session assertion |
| Scope widening | Action permission and object scope are both checked from authoritative, term-bounded roles |
| Proposal duplicates or nonce replay | Active machine-diff fingerprint and nonce registry |
| Parameter attack | Policy-owned path allowlist, type, scope, and numeric bounds; proposals cannot widen bounds |
| Delegation cycle or double voting | Frozen electorate snapshot, cycle detection, deterministic effective power, one vote per effective voter |
| One operator manipulates electorate | Evidence-bound electorate record requires distinct Technical Council approvals before voting opens |
| Snapshot tamper | Versioned SHA-256 envelope plus restore-time recomputation of proposal IDs, votes, delegation power, roles, emergency approvals, and cancellation audit |
| Malicious upgrade artifact | Exact 64-hex upgrade manifest hash required before proposal and rechecked at execution |
| Premature execution | Quorum, threshold, veto rule, timelock, and manifest checks |
| Failed execution hidden as success | Explicit verification step; failed execution requires rollback hash and becomes `rolled_back` |
| Emergency Council takes assets or permanent power | Pause-only scopes, prohibited action vocabulary, multi-member threshold, maximum duration, automatic expiry, public follow-up proposal |
| Backup substitution | Backup record SHA-256 and byte count, full snapshot validation, policy equality, and pre-restore preservation |
| Secret or identity leakage | Loopback binding, mode-`0600` key/state, aggregate metrics, coarse route logs, generic errors, request/error IDs |

## Residual risk

HMAC custody, central Gateway integration, BFT transaction signing, hardware signer ceremony, chain execution adapters, public alerting, independent voter-privacy review, bribery resistance, and public deployment have no completed evidence in this branch. Until those controls are integrated and verified, Governance is a local control plane and must not control Mainnet or user assets.
