# YNX Monitor Threat Model

Status: active local security baseline  
Product owner: `13-monitor`  
Applies to: private operator control plane, public status projection, incident evidence, backup/restore records, rollback proposals, and generated release evidence.

## Security objectives

YNX Monitor must remain an authenticated, least-privilege operational console. It may observe, correlate, record, propose, and verify operations within an approved role and scope. It must not become a custody system, treasury authority, wallet signer, Quant mandate holder, chain governance authority, or unrestricted remote shell.

The public status surface must be isolated from private operator state and must fail closed when its approved publisher feed is missing, stale, replayed, malformed, unsigned, source-mismatched, or tampered.

## Protected assets

- Operator identity, role, scope, device binding, session expiry, and revocation state.
- Session and CSRF integrity.
- Incident timeline, evidence, ownership, mitigation, recovery verification, and postmortem records.
- Backup identity, digest, retention, restore-drill evidence, and independent verification.
- Rollback proposal and independent verification records.
- Audit records and integrity-protected persisted state.
- Approved public-status publisher identity and signed source snapshots.
- Dependency lock, SBOM, build manifest, provenance, and artifact digests.
- Internal topology, log sources, provider errors, filesystem locations, and operational metadata that must not cross the public boundary.

## Trust boundaries

1. **Browser to Monitor API** — untrusted input crosses into authenticated routes. Exact Origin allowlisting, a session-bound CSRF token, bounded JSON parsing, RBAC, and explicit approvals are required.
2. **Canonical Wallet/Auth to Monitor** — external identity verification is authoritative only for the approved account and challenge. Monitor assigns only locally approved roles; replayed or expired challenges fail closed.
3. **Monitor to dependency probes** — node, validator, peer, Explorer, Indexer, and AI endpoints are untrusted availability inputs. A probe result is bounded current endpoint evidence, not historical uptime or system-wide health.
4. **Monitor state store** — local persistence is integrity protected. Corrupt or unverifiable state must not be loaded as healthy state.
5. **Private operator state to public status** — no direct read path is permitted. Public status is a separate, signed, approved, source-pinned projection with freshness and replay controls.
6. **Monitor to AI gateway** — AI is advisory only. It may summarize evidence and draft runbook steps; it cannot mutate incidents, acknowledge alerts, restart services, rotate credentials, execute rollback, or claim actions occurred.
7. **Source to build artifact** — dependency lock, source code, build toolchain, generated SBOM, and artifact manifest form the local supply-chain boundary. Missing integrity, unapproved licenses, prohibited constructs, non-reproducible output, or leaked internal strings fail the gate.
8. **Product to central owners** — Wallet/Auth, Chain Core, Data Fabric, Oracle, Quant, Security/SRE, Integration, Governance, and Website remain separately owned. Monitor consumes frozen contracts and emits handoffs; it does not recreate central authorities.

## Principal threat scenarios and controls

| Threat | Primary controls | Residual risk / required follow-up |
|---|---|---|
| Stolen or replayed operator session | short session, bearer verification, session-bound CSRF token, exact Origin allowlist, audit | canonical device binding and revocation acceptance remain central dependencies |
| Scope widening or confused-deputy mutation | route-level permission checks, scoped roles, explicit approval phrases, independent verification | transitional broad `operator` role must be retired after migration acceptance |
| Wallet challenge replay or wrong account | single-use challenge, expiry, signed payload verification, explicit role map | central Wallet/Auth contract and negative vectors require Integration freeze |
| Public status leaks private incident data | separate public source, bounded schema, redaction tests, no private store read | approved publisher feed and hosted public probe do not yet exist |
| Fake healthy status | source signature, expected publisher pin, freshness bound, replay guard, fail-closed 503 | no public SLA or cross-region evidence exists |
| Tampered persisted state | HMAC integrity, bounded parsing, restart tests | production key custody and rotation remain Security/SRE owned |
| Malicious or compromised dependency | exact lock, HTTPS resolution, integrity hashes, license allowlist, SBOM, registry-host disclosure, dependency audit | lock includes a reported registry mirror; central supply-chain acceptance is still required |
| Build tampering or non-reproducible output | two clean builds, file hash comparison, artifact string scan, build manifest | local builder is not hermetic and provenance is unsigned |
| Browser XSS or dynamic code execution | React escaping, SAST ban on dynamic evaluation and unsafe HTML injection, CSP deployment requirement | hosted DAST and deployed response-header evidence remain unavailable |
| SSRF through probe configuration | operator-controlled environment configuration, bounded timeouts, no user-supplied probe URL route | production egress allowlist must be enforced by deployment owner |
| Log disclosure | named allowlist, bounded tail, output redaction, authenticated audit | structured source-level redaction and retention policy need deployment evidence |
| AI performs an operation | advisory-only prompt and read-only streaming route, no mutation tool path | provider contract, cost, retention, and outage evidence remain external |
| Backup or rollback record mistaken for execution | typed evidence records, independent verification, explicit non-execution semantics | real restore and rollback drills require Security/SRE and environment access |
| Denial of service | JSON size limits, probe timeout, bounded text/evidence arrays | rate limiting, queueing, cross-region capacity, and load evidence remain incomplete |

## Security invariants

- `/status` never reads the private operator store.
- Missing or invalid public-status evidence returns unavailable, never a synthetic healthy state.
- Every authenticated mutation requires both an allowed Origin and a session-bound CSRF token.
- No role grants wallet signing, treasury transfer, arbitrary withdrawal, governance execution, or unrestricted command execution.
- Recovery, backup, and rollback verification must be independent from the actor who created the underlying record.
- AI output is advisory and cannot write operational state.
- Release evidence distinguishes local, testnet, staging, public, installed, signed, and store-released states.
- Generated local provenance is explicitly unsigned and cannot be represented as GitHub-hosted or production provenance.

## Validation evidence

- Authentication and mutation protection: `apps/monitor/server/auth.test.ts`
- RBAC: `apps/monitor/server/rbac.test.ts`
- Public-status isolation and tamper/replay handling: `apps/monitor/server/public-status.test.ts`
- Incident lifecycle: `apps/monitor/server/incident-lifecycle.test.ts`
- Backup, restore, and rollback lifecycle: `apps/monitor/server/recovery-lifecycle.test.ts`
- Persistence integrity: `apps/monitor/server/store.test.ts`
- Supply-chain gate: `apps/monitor/scripts/supply-chain-gate.mjs`
- Supply-chain self-tests: `apps/monitor/scripts/supply-chain-gate.test.mjs`
- Generated evidence directory: `release/monitor/security/`

## Release boundary

This threat model supports local implementation and local test evidence only. It does not prove central integration, shared Testnet operation, hosted DAST, public deployment, production signing, installation, cross-region resilience, or a Website route. Those states remain false until direct evidence is attached to the exact source commit.
