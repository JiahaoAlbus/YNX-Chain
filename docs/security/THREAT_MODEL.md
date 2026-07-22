# YNX Chain Threat Model and Security Boundaries

Status: design review candidate; independent audit and production verification pending

## Assets and trust boundaries

Critical assets are validator and service signing keys, authoritative chain state, transaction signing bytes, nonces, bridge relayer attestations, stablecoin governance records, gateway/provider credentials, webhook keys, deployment credentials, backups, audit evidence, user personal data, and release artifacts.

Trust boundaries exist between user clients and public ingress; ingress and YNX services; gateways and authoritative/BFT backends; validators and peers; primary and replicas; indexer/explorer and canonical RPC; YNX and external AI/payment/oracle/bridge/custody providers; build systems and deployment hosts; and operators and privileged control planes. A successful response from one boundary is not proof that another boundary executed.

## Principal threats and required controls

| Threat | Consequence | Required controls / current boundary |
|---|---|---|
| Key theft or signer substitution | unauthorized value movement | process-local signer, restrictive file permissions, address binding, rotation/recovery ceremony; production custody unverified |
| Replay, nonce race, or idempotency collision | duplicate/conflicting action | canonical signing, serialized nonce selection, scoped idempotency, committed-record verification |
| Quorum or peer deception | fork/stale state | validator identity, quorum rules, height/hash equality, authenticated replication; StreamBFT remains disabled candidate |
| State corruption/downgrade | loss or rollback | snapshot digest and downgrade marker, fail-closed loading, backups and restore drill |
| Provider compromise/outage | false data, leakage, unavailable workflow | allowlisted provider, timeout/rate limits, source metadata, bounded data, fail closed; approvals incomplete |
| Bridge/oracle equivocation | unsupported mint/finalization | threshold attestations, route policy, replay protection; external execution disabled |
| Stablecoin privilege abuse | wrongful mint/freeze/burn | issuer/asset lifecycle, bounded intents; external execution and native YNXT actions disabled |
| AI-induced sensitive action | unauthorized action or disclosure | consent, preview, scoped permission, explicit approval, audit; provider governance incomplete |
| API resource exhaustion | outage/cost amplification | body/response limits, rate limits, finite queues/timeouts, saturation tests pending |
| Supply-chain compromise | malicious artifact | lockfiles, checksums, build identity, dependency review, SBOM/provenance; package incomplete |
| Log/telemetry leakage | credential or personal-data exposure | structured redaction, bounded identifiers, retention/access policy; production verification pending |
| Operator error/insider abuse | unsafe deploy or evidence falsification | least privilege, two-person approval for high-risk operations, immutable audit, artifact/source matching |

## Security invariants

- Native YNXT cannot be frozen or seized by stablecoin/Trust administrative paths.
- Candidate bridge and stablecoin services cannot execute external asset actions while their deployment/execution gates are false.
- Secrets never enter consensus state, metrics, repository evidence, or public status output.
- A gateway does not report success until the accepted backend evidence matches the requested action.
- Chain ID, signer, nonce, signing bytes, release identity, and state version are explicit and verified.
- Integrity failure, ambiguous provider truth, and contradictory commit evidence fail closed for value-moving actions.

## Abuse and privacy

Threats include address harassment, false risk labels, surveillance overreach, social engineering, support impersonation, seed-phrase collection, and permanent publication of unnecessary personal data. Controls require purpose limitation, minimum necessary evidence, label confidence/expiry/review, appeal and correction routes, no native-asset administrative effect, and separation of public-chain facts from off-chain identity data.

## Verification gaps

Before launch: commission independent protocol/application/infrastructure review; exercise key compromise and recovery; fuzz parsers/signing/idempotency; run SAST, DAST, container and dependency scans; generate complete SBOM/license notices; test rate limits and denial of service; validate backup restore and N-1/quorum behavior; and prove deployed artifact provenance. Findings need severity, owner, deadline, retest, and accepted-risk authority.
