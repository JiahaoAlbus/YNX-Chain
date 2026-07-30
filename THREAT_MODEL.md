# YNX Security Platform Threat Model

## Scope and authority

The platform supplies controls, policy, release evidence, and operational tooling. It never owns user assets, signs user transactions, widens mandates, or decides business actions. Chain state, canonical Wallet/Auth, and the App Gateway remain authoritative in their respective domains.

## Trust boundaries

1. A user device is untrusted until a product-bound device challenge and short-lived session are verified.
2. Internet ingress terminates TLS at the managed edge; every service-to-service hop requires a workload identity and mTLS in production.
3. Build workers are separate from deploy workers. Builds cannot read production credentials. Deploy workers consume immutable, verified artifacts only.
4. Secret Manager or an approved HSM/MPC system owns key material. Git, CI logs, browsers, screenshots, AI contexts, release archives, and application logs may hold references but never values.
5. Backup storage is a separate failure and authorization domain. Signer recovery is deliberately separate from data recovery.

## Principal threats and controls

| Threat | Prevent | Detect | Recover |
| --- | --- | --- | --- |
| Stolen service credential | short lifetime, audience binding, mTLS, least privilege | access audit, impossible-use alert | revoke identity, rotate, isolate workload |
| Session replay or scope widening | nonce domain, product/device/bundle binding, exact scopes, expiry | rejected-auth metrics with request ID | revoke session family and investigate |
| CI dependency or build compromise | lockfiles, review, script allowlist, dependency and license review, isolated build | SAST, SBOM diff, provenance verification | halt promotion, revoke artifact, rebuild clean |
| Artifact replacement | immutable digest, provenance, signature verification at deploy | registry reconciliation | rollback to verified digest and revoke release |
| Secret disclosure | manager references only, redaction, tracked-file scan | secret scan and audit alert | revoke, rotate, forensic preservation |
| Database or object loss | encrypted atomic backup, integrity manifest, offline copy | restore drill and checksum monitor | cross-region restore within declared RTO/RPO |
| Region or edge failure | bounded multi-region candidate design, quotas, rate limits | synthetic probes, saturation and availability alerts | controlled failover and status communication |
| DDoS and abuse | WAF, rate limits, resource quotas, cost ceilings | edge, queue, error, and spend alerts | shed load, tighten policy, preserve read paths |
| Break-glass abuse | time-bound access and multi-party approval | immutable audit event and immediate alert | revoke grant, rotate affected credentials, review |
| Worker escape | sandbox, network policy, no user keys, explicit egress | denied syscall/egress telemetry | kill switch, isolate node, rotate identity |
| SEO compromise | deploy-time crawler gate and content integrity | canonical/noindex/spam monitors | rollback and request recrawl after correction |

## Security invariants

- Authentication and authorization fail closed on missing, stale, malformed, wrong-product, wrong-device, wrong-bundle, widened-scope, revoked, or replayed evidence.
- A restore never restores signer authority automatically.
- A green build cannot promote itself.
- An artifact without digest, SBOM, provenance, signature class, installation evidence, revocation procedure, and expiry is not publicly releasable.
- Testnet credentials and test signatures never imply production readiness.

## Residual risks

External penetration testing, a staffed 24/7 response function, production HSM selection, production multi-region deployment, and legally approved notification channels are not evidenced in this repository. Their corresponding release states remain false.
