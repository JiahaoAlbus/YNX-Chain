# YNX Search Integration Handoff

Version: 1.3.0

Product owner: `23-search`

Source commit: `88ee867322ec11a243a483c04bab99676cc3416e`

Current phase: `FREEZE`

## Product boundary

YNX Search owns reviewed source registration, bounded indexing, Search result and
receipt schemas, ranking explanations, public Search feeds, and the Search-side
adapter for correction, removal, and appeal. It does not own Wallet identity,
AI provider execution, Trust adjudication, Browser runtime, canonical event
storage, public website routing, or final release approval.

Search never claims global web coverage. The current staging service covers only
registered and authorized sources and currently has an intentionally empty
approved corpus. Staging remains on historical commit
`d68b5d89c0d2e92744bf634c55b776397ec8f896`; the current source commit is not yet
deployed.

## Accepted local capabilities

- Source Registry v4 records ownership, authorization digest, robots and terms,
  permitted scope, data rights, explicit versioned public data classes, retention,
  remedies, languages, freshness, rate limit, and backoff.
- Pre-v4 sources without reviewed public classes migrate disabled and require
  renewed review. No class is inferred and no source is silently re-enabled.
- Ingestion rejects private, internal, unknown, out-of-source-policy, and
  high-confidence credential or engineering content before persistence.
- Crawler rejects private, loopback, link-local, metadata, documentation,
  multicast, and DNS-rebinding destinations before content fetch.
- Public index status exposes authorization digests and reviewed data policy, not
  raw evidence references.
- AI retrieval includes only sources with explicit AI retrieval rights. User
  filters cannot override the server-enforced AI-only retrieval boundary.
- Search result schema v4 exposes source, scope, source-use rights, data class, language, freshness,
  receipt, remedies, query intent, policy version, and versioned ranking factors.
  Authority and quality remain labeled registered-policy and
  governance-completeness proxies.
- Canonical entity registry resolves YNX, YNX Web4, YNXWeb4, YNXT, 6423, and
  product names; YNX is never silently corrected to Lynx.
- Vector retrieval remains `candidate-disabled`; no embedding capability is
  claimed.
- Six deterministic public feeds and a SHA-256 manifest exist under
  `release/public/search`; they are local artifacts and are not hosted.
- Remedy cases and Wallet callback challenges are persistent and replay-safe.
- Source Registry v4 backups bind exact database bytes, manifest metadata, index
  receipts, and the deterministic public projection. Restore/reindex are
  separate-path-only and preserve source-use boundaries.
- 31 unit/integration tests, service smoke including AI data-right override denial,
  dependency-independent secret scan, deterministic feed verification, six
  Playwright scenarios, shared permissions tests, and production dependency audit
  pass locally.
- Every response carries Request and Trace correlation; bounded errors add an Error
  ID. Structured logs exclude query strings, bodies, IP addresses, error messages,
  source snippets, Wallet data, and authorization evidence.
- `/api/metrics` is an operator-authenticated, fail-closed Prometheus endpoint.
  Central Monitor acceptance and current-source staging evidence remain pending.
- The reproducible local loopback benchmark at this source commit passed 80/80
  requests at concurrency 8 with p95 22.57 ms; it is not staging, public, or
  production capacity evidence.

## Required owner actions

### 02 Wallet/Auth

Freeze the Product Registry tuple, exact callback, ordered scopes, device
challenge, approval digest, Product Session, introspection, expiry, and revoke.
Search accepts callback binding locally but does not create a session until the
central Gateway verifies it.

### 14 AI

Register a Search citation workflow. The Gateway must accept only the selected
retrieval set, return citations from that set, expose provider/model/cost/status,
and support cancel, quota, timeout, and unavailable semantics.

### 15 Trust Center

Accept Search remedy cases using a canonical case ID and event contract. Search
needs submitted, under-review, accepted, rejected, corrected, removed, and appeal
states while Trust remains the authority for review outcomes.

### 22 Browser

Consume the reviewed Search route as a separate product. Browser must preserve
query text on failure, tolerate additive result and migration fields, distinguish
YNX Index from external results and AI answers, and never imply that Search or
Browser signs Wallet actions.

### 26 Data Fabric

Freeze Search canonical events and public data-class labels. The Search-local v4
allowlist is fail-closed and tested but is not evidence of central label acceptance.
Private Social, Mail, Cloud, Wallet, strategy, operator, credential, secret, and
internal engineering classes must remain rejected.

### 28 Website

Consume `public-product-metadata.json` and the six public feed files. Publish the
canonical `/search` route, FAQ, support/privacy/security/status paths, and
structured data without exposing repository or local engineering metadata.

### 13 Monitor

Scrape `/api/metrics` only through an authenticated private path, preserve the
normalized low-cardinality labels, alert on server error rate, latency, missing
scrapes, restart and stale deployed commit, and keep source status separate from
external provider health. Central Monitor acceptance is not yet proven.

### 29 Integration

Freeze `release/integration/search-contract.json` v1.4.0, dependency acceptance,
event and error ownership, migration order, and the shared Testnet sequence.

### 30 Security/SRE/Release

Review outbound network policy, secret scan, dependency lock, SBOM, artifact
provenance, deployment least privilege, the local recovery format, and
current-source staging promotion. Local recovery is not encrypted, off-site
durability evidence, or an operational RPO.

## Integration gates

1. Contract and test vectors accepted by relevant owners.
2. Current source commit deployed to staging with exact `/api/health` commit.
3. Approved Testnet source inventory contains only accepted public data classes.
4. Canonical entity aliases and ranking explanations are implemented and tested.
5. Public feed artifacts are generated deterministically with hashes.
6. Wallet, Trust, Browser, AI, Data Fabric, Monitor, Website, and Integration
   negative vectors pass.
7. Versioned backup, restore, rollback, and reindex drills pass.
8. Public and artifact states remain false until direct evidence exists.

## Failure contract

- Empty corpus is a successful empty result, not fabricated coverage.
- Missing central dependencies remain unavailable and cannot be replaced by mocks.
- Pre-v4 source governance is disabled until reviewed public classes are supplied.
- Private, internal, unknown, out-of-policy, and sensitive content fails before
  persistence.
- AI data-right enforcement cannot be weakened by client filters.
- Provider errors, rate limits, stale data, denied robots, unsafe destinations,
  and expired or replayed Wallet requests fail closed with visible state.
