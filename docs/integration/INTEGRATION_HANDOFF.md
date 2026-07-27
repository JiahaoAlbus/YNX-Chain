# YNX Browser integration handoff

Version: 0.2.1-candidate  
Browser source commit: `0515ff50b22547840c6554b29c4af3cd17484800`  
Branch: `codex/final-browser`  
As of: 2026-07-27  
Goal: Active  
Phase: PROTECT moving toward FREEZE

## Product ownership

YNX Browser owns the real platform browser clients, browser chrome, local session/privacy boundaries, local permission mediation, threat-warning presentation, Web4 request recognition and exact Wallet review handoff. It does not own Wallet signatures or Product Sessions, Search truth, canonical Data Fabric events, public hosting, release signing, central protocol freeze or shared Testnet orchestration.

## Protected runtime slice

Commit `06fb7ee7e321743288348feefa3fb76e9f096463` fixes a macOS WKWebView privacy and attribution defect:

- Download context is captured from the initiating `WKWebView` and `WKNavigationResponse`, not whichever tab happens to be active when the download completes.
- The context includes the initiating tab's Private state and the user-selected destination filename.
- Private downloads can leave the selected operating-system file, but never write a normal YNX Downloads record.
- Missing download context fails closed and writes no Browser record.
- Cancellation and failure remove retained context.

This change preserves the product's truthful Private boundary rather than claiming downloaded files disappear.

Commit `91685b728cefefabec9414317f2663d659062edc` adds the recoverable Browser state-v2 lifecycle:

- v1 state migrates atomically to v2 while retaining a v1 rollback backup.
- Persisted Private tabs, closed tabs, bookmarks, history and download metadata are filtered during migration.
- Tab identity and Private classification cannot be mutated through generic patch input.
- Corrupt primary state recovers from a validated backup; unsupported future versions fail closed.
- Explicit backup, restore, export and selective deletion APIs are covered by tests. Audit export remains opt-in.

These APIs are tested local core capabilities; native UI wiring and installed restore drills remain open.

Commit `0515ff50b22547840c6554b29c4af3cd17484800` closes the Windows Wallet request-builder gap:

- Windows CNG persists an ECDSA P-256 device key with no private-key export policy.
- The exact Browser tuple, Callback, ordered scopes, Chain ID and five-minute expiry are encoded into Wallet review.
- Pending Nonce and bindings are signed by the device key before local persistence.
- Callback parsing rejects duplicate or unknown query fields, validates signed pending state and exact response bindings, and consumes the request once.
- Browser still performs no Gateway signature verification locally, creates no Product Session, and signs no transaction.

Windows source and cross-platform contracts are tested, but compile/package/protocol-registration evidence remains blocked because this workspace has no .NET SDK or Windows host.

## Verification

| Check | Result | Truth boundary |
| --- | --- | --- |
| `cd apps/browser && npm test` | Pass: 14/14 | Covers platform source gates, private-download metadata, state migration, tamper resistance, backup/restore, export/delete and Windows Wallet source boundary |
| `cd packages/web4-permissions && npm test` | Pass: 15/15 | Covers all four exact Browser tuples, callback/scope/chain/replay rejection and the non-exportable Windows CNG builder boundary |
| `git diff --check` before runtime commits | Pass | No whitespace/patch-format errors |
| macOS Swift package build at current commit | Not verified | Swift compiler/package-manager processes hung or exceeded the MCP command window; no current-commit build pass is claimed |
| Windows WPF build at current commit | Blocked before compile | `dotnet` is absent from this macOS workspace; no Windows build/package/install claim is made |
| Platform install/cold-start | Not rerun | Historical evidence remains historical and is not automatically attributed to this commit |
| Public deployment/artifacts/signing | Not verified | All release-state booleans remain false except `implementedLocal` |

## Candidate contract

- Browser contract: `release/integration/browser-contract.json`
- Cross-product vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- Dependency acceptance: `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- Full goal coverage: `.ai-bridge/full-goal-coverage.json`
- Machine release state: `apps/browser/product-release.json`

The contract is a Browser-owned candidate. It is not a central protocol freeze. Wallet registry authority remains with product 02; canonical event authority remains with product 26; final freeze and shared Testnet remain with product 29.

## Required central acceptances

1. **02 Wallet/Auth** — accept or migrate the four platform client tuples, exact callbacks, ordered scopes, P-256 device binding and five-minute request boundary. Run approve, reject, replay, expiry, wrong product/bundle/device/callback and revoke vectors.
2. **14 AI** — accept Browser context and tool policy, provider/model/cost state, streaming/cancel and audit contract. Private pages remain forbidden.
3. **23 Search** — provide the reviewed Search endpoint, authorized source inventory, suggestion provenance and outage/stale semantics.
4. **26 Data Fabric** — map local audit names to one canonical version with privacy-safe payloads, retention and redaction. Until accepted, local strings are not canonical events.
5. **28 Website** — consume truthful Browser metadata and immutable artifact records only after direct hosting evidence exists.
6. **29 Integration** — freeze one contract/error/event version and run the shared Search → Wallet → Pay/Quant/DEX → Explorer flow with revoke and failure evidence.
7. **30 Security/SRE/Release** — rerun scans and builds at the final commit, issue provenance, define threat policy and produce signing/hosted-artifact evidence.

## Exact next Browser action

Protect and push `06fb7ee`, `91685b7` and `0515ff5`, then restore deterministic Swift execution and build the macOS host at `0515ff50b22547840c6554b29c4af3cd17484800`. In parallel, run Windows CI with .NET 8 to compile/package the CNG Wallet builder, register the `ynxbrowser` callback protocol and execute replay/tamper/expiry tests. After installed evidence exists, submit the four tuples to Wallet/Auth for central acceptance.

## Blockers

- Swift compiler/package-manager execution is currently non-deterministic in this workspace session.
- Central contracts and shared Testnet endpoints are not yet accepted in this branch.
- Windows build, full Xcode/simulator, production signing, notarization, store release, hosted downloads and public `/browser` proof remain unverified.

No secret, signer, payment, transaction or Wallet private key is requested or stored by this handoff.
