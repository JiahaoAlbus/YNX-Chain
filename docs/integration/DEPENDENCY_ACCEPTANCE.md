# YNX Search Dependency Acceptance

Source commit: `66bc18ea697be99a990143ab0b843652c49931b7`  
Contract: `release/integration/search-contract.json` v1.2.0  
Status: pending central acceptance

| Owner | Dependency | Search acceptance criteria | Current state |
|---|---|---|---|
| 02 Wallet/Auth | Product Registry and Product Session | Exact product/client/bundle/callback/device/account/ordered scopes/purpose/nonce/expiry binding; replay, tamper, widening, expiry and revoke fail closed | Local callback binding tested; central session unavailable |
| 14 AI | Citation Gateway | Provider/model/status/cost exposed; only approved retrieved URLs accepted; cancel, quota, timeout and unavailable states truthful | Adapter and negative tests local; AI retrieval rights cannot be overridden by client filters; provider run pending |
| 15 Trust Center | Remedy cases | Canonical case ID, evidence hash, review/appeal/correction/removal events, retention and redaction | Local durable cases tested; central review pending |
| 22 Browser | Search client | Independent product route; preserves query and failure state; tolerates result schema v3/data class fields; distinguishes YNX Index, External Result and AI Answer | Handoff and vectors exist; acceptance pending |
| 26 Data Fabric | Events and data classes | Canonical Search event names and accepted explicit public-only ingestion labels; private/internal/credential classes rejected | Search-owned Source Registry v4 allowlist and negative gates tested; canonical label acceptance pending |
| 28 Website | Public entry | `/search`, metadata, FAQ, support/privacy/security/status routes, six public feeds, canonical and structured data | Metadata and deterministic feeds ready locally; hosting and route pending |
| 29 Integration | Protocol freeze | One accepted source v4, result v3, receipt, event, error, auth and release contract | Proposed v1.2.0; pending freeze |
| 30 Security/SRE | Release gate | Outbound policy, lockfile, SBOM, provenance, least privilege, backup/restore and current-source staging verification | Local outbound, data-leak gates, scans and dependency audit pass; recovery and release review pending |

## Rules

- Search does not implement substitute central Wallet, AI, Trust, Data Fabric,
  Website, Integration, or Security owners.
- Missing dependencies remain visibly unavailable.
- The Search-local public-class registry is a fail-closed product boundary, not
  proof that Data Fabric has accepted canonical labels.
- A local adapter or passing fixture is not central integration evidence.
- Staging evidence at commit `d68b5d89c0d2e92744bf634c55b776397ec8f896`
  does not prove deployment of the current source commit.
- Acceptance must reference exact contract version, source commit, test-vector IDs,
  and observed health/version evidence.
