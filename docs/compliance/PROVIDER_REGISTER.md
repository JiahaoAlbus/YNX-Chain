# YNX Provider and External Dependency Register

| Metadata | Value |
| --- | --- |
| Version | 0.1.0-candidate |
| Effective date | 2026-07-22 |
| Accepted central source | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Engineering inventory; procurement, privacy, security and legal approval incomplete |

## Direct answer

No external provider is authorized by this document to replace YNX Wallet
identity, chain state, balances, permissions, transactions, settlements,
receipts, Trust cases or protocol governance. Provider availability, contract
terms and configured credentials are release-specific. Empty environment fields
and adapter code are not proof of an active service.

This register records recovered dependencies and candidate integrations. Unknown
or unverified fields fail closed and block production claims.

## Required provider record

Every provider integration requires:

- provider, product and service owner;
- purpose and authoritative scope;
- official API/SDK/standard reference;
- license and open-source obligations;
- commercial terms and acceptable-use restrictions;
- contracting entity and jurisdictions;
- authentication and secret custody;
- rate, quota and concurrency limits;
- data sent, retention, training/use and deletion;
- customer/user data rights and export;
- API/model/feed version and change policy;
- health and freshness checks;
- fallback and fail-closed behavior;
- outage, incident and support path;
- cost source and observation time; and
- approval, staging, public deployment and evidence state.

## Recovered register

| ID | Provider / dependency | Purpose and authority | License / terms / jurisdiction | Authentication | Limits | Data, retention and rights | Version / health / fallback | Current status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRV-001 | OpenAI-compatible AI endpoint | Drafting and explanation only; never chain/account/action authority | Provider identity, commercial terms, model rights, training/retention and jurisdictions require release-specific review | Server-side API key; must not reach clients, logs or prompts | Provider quota and rate limits unknown until contracted/configured | Selected context only after consent; retention/deletion and training policy must be recorded | URL/model are configuration; health must distinguish configured, reachable, quota and generation result; fail closed without provider | Adapter/config surface exists; successful production provider service is not proved |
| PRV-002 | PostgreSQL-compatible database | Application persistence where configured; not consensus authority | Deployment/provider and license/terms depend on selected service; not selected here | Server-side connection secret with least privilege and TLS | Capacity/connections/backup limits unmeasured | Product data schema, retention, export/delete and backup location require review | Version, replication, health, migration and restore evidence absent | Empty configuration surface; no provider approval inferred |
| PRV-003 | Redis-compatible service | Cache, queue or rate-limit support where configured; never authoritative user/chain state | Deployment/provider and terms not selected | Server-side connection secret and network isolation | Memory, eviction, connections and rate limits unmeasured | Must not become sole durable store; retention and deletion depend on use | Version, persistence mode, health and failover absent | Empty configuration surface; no provider approval inferred |
| PRV-004 | CometBFT | Accepted consensus-engine software baseline | Open-source license and notices require final bundled notice review; no hosted-provider contract implied | Validator/node keys and private P2P/RPC controls | Consensus limits require measured configuration | Consensus state and peer metadata under operator retention policy | Pinned `v0.38.23`; local quorum evidence exists; public/remote evidence remains release-specific | Direct software dependency; not a third-party hosted authority |
| PRV-005 | Circle CCTP | Candidate official stablecoin transfer route only if YNX becomes officially supported | Official product terms, supported domains, issuer/legal/jurisdiction and data terms require review | Not applicable without supported route; no credentials present | No YNX route limits established | No user/provider data transfer authorized | Owner evidence records YNX absent from inspected Testnet contract table; independent refresh timed out; fallback is unavailable | Unavailable; no contracts, funding, remote test or public deployment |
| PRV-006 | GitHub | Source hosting, Actions and release artifacts | Account/organization terms, repository visibility, retention and artifact policy require owner review | Owner account/token or app; tokens remain outside source | API/Actions/artifact quotas are plan-specific and not recorded | Source, logs and artifacts subject to repository/workflow policy | Git remote and four prereleases observed; Actions API timed out during audit | Source remote active; CI status unverified; not application authority |
| PRV-007 | ethereum-lists/chains / chainid.network data | Chain-ID collision research and submission candidate | Upstream repository/data license and submission terms require final review | Public read; submission requires separate owner authorization | Public endpoint/repository limits not recorded | Public network metadata only | Evidence snapshot dated 2026-07-01; must be refreshed before submission; absence from a snapshot is not permanent reservation | Research evidence only; no Chainlist acceptance/default wallet support |
| PRV-008 | Prometheus | Metrics collection format/runtime dependency | Open-source notices required; hosted service not selected | Protected scrape/network policy where deployed | Retention/cardinality/capacity unmeasured | Metrics must exclude secrets and unnecessary user data; retention unapproved | Config and local checks exist; remote target/HA evidence varies by service | Local/deployment configuration only |
| PRV-009 | Grafana-compatible dashboard | Operator visualization; never authoritative product state | Open-source notices required; hosted service not selected | Authenticated operator access | User/query/retention limits unmeasured | Dashboard data follows metrics/log retention and access policy | Starter dashboard exists; alert delivery and public status evidence incomplete | Configuration asset only |
| PRV-010 | Email provider | Support/notification delivery candidate | Provider not selected; messaging, privacy, anti-spam and jurisdiction review required | Server-side credential; no client exposure | Quota, bounce and abuse limits unknown | Recipient, content, retention, deletion and lawful basis undefined | Health, delivery receipt, suppression, outage and fallback undefined | Empty configuration field; no internet-mail service claimed |
| PRV-011 | Object storage provider | Cloud/media/artifact storage candidate | Provider, region, terms, data location and license not selected centrally | Least-privilege server role/key; signed URLs bounded by object and expiry | Quota, size, bandwidth, lifecycle and request limits unapproved | Encryption, retention, legal hold, export/delete and recovery required | Versioning, integrity, malware scan, health and restore evidence product-specific | No central production provider approval inferred |
| PRV-012 | WalletConnect | Candidate wallet session interoperability | Project terms, privacy, relay behavior and metadata requirements need review | Product/project identity and bounded session; no user seed | Relay and project limits unrecorded | Session metadata and relay retention/data rights require review | Guide exists; no default support or approved production integration claimed | Documentation/readiness only |

## Authority boundary

| Data or action | Required authority | Provider role |
| --- | --- | --- |
| Wallet identity and user signature | Canonical Wallet and device/account proof | Provider cannot substitute |
| Balance, nonce and transaction finality | Authoritative committed chain state | RPC/index provider supplies a bounded observation with source/freshness |
| Product permission | Canonical approval, product session and Gateway introspection | Provider cannot widen scope |
| Payment settlement and receipt | Committed transaction plus accepted Pay record | Payment provider supplies only its own rail status |
| Exchange custody/order | Approved venue/custody adapter and account | Market-data provider cannot assert it |
| Stablecoin reserve/redemption | Issuer, bank/custodian and independent attestation | Price or bridge provider cannot assert it |
| Bridge completion | Source/destination state and approved route proof | Relayer/provider evidence is bounded input |
| Trust case or legal action | Defined governance/legal authority with evidence and appeal | AI/label/data provider is input only |

## Outage policy

Every integration must expose configured, reachable, authenticated, rate-limited,
degraded, stale, unavailable and rejected states separately. An outage must not
produce cached success, zero-as-data, fabricated balance, fabricated health or a
silent provider swap. A fallback requires the same authority scope, user/privacy
review, freshness and visible source.

## Credential policy

Credentials remain in an approved secret store or mode-restricted server file.
They must not enter source, public artifacts, browser bundles, screenshots,
support tickets, analytics, prompts or chat. The final operator request may ask
for a secure credential path or approval, never the complete secret itself.

## Review and update cadence

Provider records are reviewed before first integration, on material term/version/
jurisdiction changes, after incidents, and at least every release cycle for active
providers. Each review records official source URL, access date, reviewer,
decision, exceptions and expiry. The current register lacks those completed
reviews and therefore does not authorize production use.

## Change log

- 0.1.0-candidate (2026-07-22): Established the provider schema, recovered
  provider/dependency inventory, authority boundaries, outage and credential
  policy, and explicit unapproved/unverified states.
