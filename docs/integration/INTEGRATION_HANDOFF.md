# YNX Search Integration Handoff

Version: 1.0.0  
Product owner: `23-search`  
Source commit: `84e0655c7c3c1106eceae72bc11361e242132f48`  
Current phase: `FREEZE`

## Product boundary

YNX Search owns reviewed source registration, bounded indexing, Search result and
receipt schemas, ranking explanations, public Search feeds, and the Search-side
adapter for correction, removal, and appeal. It does not own Wallet identity,
AI provider execution, Trust adjudication, Browser runtime, canonical event
storage, public website routing, or final release approval.

Search never claims global web coverage. The current staging service covers only
registered and authorized sources and currently has an intentionally empty
approved corpus. The current security commit is not yet deployed to staging.

## Accepted local capabilities

- Source Registry v3 records ownership, authorization digest, robots and terms,
  permitted scope, data rights, retention, remedies, languages, freshness,
  rate limit, and backoff.
- Legacy v2 sources migrate disabled and require renewed review.
- Crawler rejects private, loopback, link-local, metadata, documentation,
  multicast, and DNS-rebinding destinations before content fetch.
- Public index status exposes authorization digests, not internal references.
- AI retrieval includes only sources with explicit AI retrieval rights.
- Search result schema v2 exposes source, scope, language, freshness, receipt,
  remedies, query intent and versioned ranking factors. Authority and quality are
  explicitly labeled as registered-policy and governance-completeness proxies.
- Canonical entity registry resolves YNX, YNX Web4, YNXWeb4, YNXT, 6423 and
  product names; YNX is never silently corrected to Lynx.
- Vector retrieval remains `candidate-disabled`; no embedding capability is
  claimed.
- Six deterministic public feeds and a SHA-256 manifest exist under
  `release/public/search`; they are local artifacts and are not hosted.
- Remedy cases and Wallet callback challenges are persistent and replay-safe.
- 19 unit/integration tests, service smoke, dependency-independent secret scan,
  deterministic feed verification, six Playwright scenarios, and production
  dependency audit pass locally.

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
query text on failure, distinguish YNX Index from external results and AI answers,
and never imply that Search or Browser signs Wallet actions.

### 26 Data Fabric

Freeze Search canonical events and public data-class labels. Private Social,
Mail, Cloud, Wallet, strategy, operator, credential, and secret classes must be
rejected at ingestion.

### 28 Website

Consume `public-product-metadata.json` and the future six public feed files.
Publish the canonical `/search` route, FAQ, support/privacy/security/status paths,
and structured data without exposing repository or local engineering metadata.

### 29 Integration

Freeze `release/integration/search-contract.json`, dependency acceptance, event
and error ownership, migration order, and the shared Testnet sequence.

### 30 Security/SRE/Release

Review outbound network policy, secret scan, dependency lock, SBOM, artifact
provenance, deployment least privilege, backup/restore, and current-source staging
promotion.

## Integration gates

1. Contract and test vectors accepted by relevant owners.
2. Current source commit deployed to staging with exact `/api/health` commit.
3. Approved Testnet source inventory contains no private data classes.
4. Canonical entity aliases and ranking explanations are implemented and tested.
5. Public feed artifacts are generated deterministically with hashes.
6. Wallet, Trust, Browser, AI, Data Fabric, Monitor, Website, and Integration
   negative vectors pass.
7. Public and artifact states remain false until direct evidence exists.

## Failure contract

- Empty corpus is a successful empty result, not fabricated coverage.
- Missing central dependencies remain unavailable and cannot be replaced by mocks.
- Legacy source governance is disabled until reviewed.
- Provider errors, rate limits, stale data, denied robots, unsafe destinations,
  and expired or replayed Wallet requests fail closed with visible state.
