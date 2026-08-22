# YNX Developer Dependency Acceptance

## Current source

- Product owner: `11-developer`
- Branch: `codex/ynx-code-platform-v1`
- Audited repository checkpoint: `e061a30e801a9075dfea212a854b3d7d578d7e85`
- Runtime source checkpoint: `17ee9ae5bf50677a3316b0838884dd135de80599`
- Contract version: `ynx-developer-integration-v1` / `1.0.0`
- Current phase: `FREEZE`

No dependency below is treated as accepted merely because an adapter, template, or test fixture exists. Central integration remains false until the owning product records acceptance against the exact contract version and source commit.

## Acceptance register

| Dependency owner | Required acceptance | Delivered evidence | Current status | Acceptance gate |
| --- | --- | --- | --- | --- |
| 02 Wallet/Auth | Exact Developer product tuple, P-256 product-device completion, memory-only Product Session, Wallet-only deployment provider | `release/integration/developer-contract.json`, existing Wallet tests and handoff | Pending owner acceptance | Owner publishes accepted registry version and cross-product replay/tamper/revoke results |
| 14 AI | Developer POST-body AI workflow, streaming/cancel, quota/provider error truth, cost and retention metadata | Existing AI client tests and `docs/handoffs/developer.md` | Pending owner acceptance | Canonical AI Gateway accepts exact workflow without query-carried prompts |
| 19 Oracle | Oracle API Studio template fields and stale/source/version/confidence consumer boundary | API Studio template and cross-product vector `developer-api-001` | Pending owner acceptance | Oracle owner confirms path/schema/version or supplies migration |
| 21 Bridge | Bridge quote template remains a quote and does not claim settlement | API Studio template and adapter manifest generator | Pending owner acceptance | Bridge owner confirms canonical quote schema and failure states |
| 06 Card | Issuer-sandbox-only Card template and non-production truth | API Studio template | Pending owner acceptance | Card owner confirms sandbox lifecycle and sensitive-data boundary |
| 23 Search | Public-index search template and query boundary | API Studio template and local broker fixture test | Pending owner acceptance | Search owner confirms query schema, rate limits, and permitted data class |
| 20 Cloud | Object-upload-intent template without browser credentials | API Studio template | Pending owner acceptance | Cloud owner confirms object intent schema, limits, and retention |
| 25 Mail | Draft-only template that cannot send mail | API Studio template | Pending owner acceptance | Mail owner confirms draft schema and separate send approval contract |
| 09 Shop | Shipping quote template without fulfillment claims | API Studio template | Pending owner acceptance | Shop owner confirms provider/manual tracking distinction |
| 26 Data Fabric | Canonical audit events, payload schema, redaction, retention, and billing boundary | Proposed events in Developer contract and vector `developer-api-009` | Pending owner acceptance | Data Fabric publishes accepted event version and redaction vectors |
| 29 Integration | Freeze one Developer contract/error/event version and execute cross-product vectors | Contract, handoff, and ten vectors | Pending integration freeze | Integration records accepted commit/version and conflict disposition |
| 30 Security/SRE | Host credential broker, origin policy, response limits, logs/redaction, artifact and release truth | API Studio source/tests/docs and vector set | Pending security review | Security owner accepts broker contract or returns a versioned migration |
| 28 Website | Canonical `/developer` page, hosted downloads, public status and SEO package | Existing product metadata is incomplete for current checkpoint | Not started | Website receives current metadata, screenshots, immutable artifacts, and public evidence |

## Developer-side acceptance already complete

The Developer owner accepts these local invariants for source commit `8f352d0159eef0ab60fb6411e949cfcf3aafb551`:

1. OpenAPI imports are JSON-only and bounded.
2. External references are rejected rather than fetched implicitly.
3. Browser state contains credential references, never credential values.
4. Secured requests require an injected host broker.
5. Every sandbox request requires a reviewed preview and explicit approval.
6. Only reviewed origins may be contacted.
7. Provider failures remain failures.
8. Localized human messages preserve stable machine error codes for cross-product consumers.
9. Arabic RTL is scoped to interaction surfaces; source, JSON and URL fields remain LTR.
10. Keyboard tab navigation follows a deterministic tablist contract and output announcements use a polite live region.
11. Current-source browser accessibility evidence is accepted locally for clean source `f38aa95a9ec7ebff68b4d915f41b20ad8f903769`: 15/15 Chrome checks and six hashed screenshots passed. This is product-owner evidence, not an independent certification.
12. Current-source API Studio installation is accepted locally for macOS arm64 and Windows x64 package source `7f976c1e06292360160325b00fa0875e6a2567f6`. The macOS ZIP SHA-256 is `ff9ae3d473f961f38294679a7bdb21c7cc0c905d7791efe9d4b114fc1df903f7`; the Windows ZIP SHA-256 is `1efaf486164da71d907a8869e5e749fe46bf0bb1a74625f12ddab1692d07fb29`. Both are unsigned Testnet Preview artifacts; Windows run `30417693593` produced only a transient CI Artifact pending pre-release publication.

## Conflict handling

Any owner disagreement about operation paths, security schemes, events, errors, scopes, or release states must be recorded as a versioned conflict and submitted to `29-integration`. Developer will remain fail closed and will not silently support two long-lived canonical contracts.

## Next acceptance action

`30-security-sre` and `29-integration` should first review the host broker and error contract. After acceptance, one owning provider thread can supply a credential-safe sandbox adapter and execute its corresponding cross-product vector. No credential should be pasted into chat or stored in Developer browser state.
