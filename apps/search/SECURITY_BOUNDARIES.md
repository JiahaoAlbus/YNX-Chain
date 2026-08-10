# YNX Search Security Boundaries

Effective: 2026-07-27
Source commit: `52c70f74220df06208b6a415580a5a879c4a8cb8`

## Trust zones

1. **Public client:** submits queries and same-origin remedy or privacy requests.
   It holds no crawler, provider, Wallet, Trust, AI or deployment credential.
2. **Search service:** validates requests, queries the reviewed local index,
   prepares bounded AI context, and persists source/case/audit state.
3. **Source operator:** registers reviewed sources using an out-of-band credential
   reference. Raw authorization evidence is never returned publicly.
4. **Outbound crawler:** may request only validated public HTTPS destinations and
   exact registered origins. Redirects are rejected.
5. **Central dependencies:** Wallet/Auth, AI, Trust, Data Fabric and Monitor remain
   separate authorities. Their absence is an unavailable state, not local success.

## Data boundary

Allowed ingestion is explicit public or authorized content covered by the Source
Registry record. Private messages, mail, cloud files, Wallet sessions, private
strategy code or data, API keys, operator logs, local engineering paths, branch
metadata, credentials and secrets are prohibited.

Searchable data and AI-retrievable data are separate rights. A source may be
searchable while `dataRights.aiRetrieval=false`.

## Outbound policy

Before robots or content fetch, the service validates URL syntax and every DNS
answer. It rejects credentials in URLs, fragments, non-HTTPS destinations,
localhost and metadata names, loopback, private, carrier-grade NAT, link-local,
documentation, multicast, reserved and IPv4-mapped private IPv6 addresses. A
response URL must stay on the registered origin.

Failures are persisted with backoff. Robots denial is a distinct non-success
state. Unsupported content types, responses over 2 MB, timeouts and unsafe
redirects fail closed.

## Authorization boundary

- Source administration requires the operator token reference.
- Public mutating routes enforce same-origin checks and rate limits.
- Wallet callbacks are product, bundle, device, nonce and expiry bound and are
  consumed once. Search does not create a Product Session or sign.
- AI requires explicit context consent and citations restricted to the retrieved
  set. It cannot change source governance, cases, permissions or release state.

## Public evidence boundary

Public `/api/index/status` includes governance digests and review dates but omits
raw authorization and override references. Health and release files distinguish
local, historical staging, current-source staging, public, hosted and signed
states.

## Remaining security work

- explicit public data-class allowlist at ingestion;
- structured security events and Monitor alerts;
- SBOM, third-party notices and artifact provenance;
- container/runtime least-privilege scan;
- v3 backup/restore and retention drill;
- external penetration test and Security/SRE release acceptance.
