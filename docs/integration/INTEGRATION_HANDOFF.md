# YNX Browser integration handoff

Version: 0.2.2-candidate
Browser source commit: `f2f9aaed8d3e4231d37c94de352077008a338572`
Native download runtime commit: `668cb44dab95374ba9e5342d754b6ec568564f2b`
Branch: `codex/final-browser`  
As of: 2026-07-27  
Goal: Active  
Phase: FREEZE

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

Commit `668cb44dab95374ba9e5342d754b6ec568564f2b` moves the exact persistence policy into `YNXBrowserCore`, makes the WKDownload delegate call that shared function, and adds three native tests proving normal source/filename persistence and zero Private metadata writes. It also removes the third-party example-domain runtime fallback and adds a Browser production-source gate. This is deterministic policy evidence, not a completed WKWebView plus NSSavePanel interaction recording.

Commit `f2f9aaed8d3e4231d37c94de352077008a338572` normalizes archive metadata and entry order. Two consecutive same-host builds produced the same ZIP SHA-256. This proves only same-host/toolchain reproducibility and does not upgrade the ad-hoc signing class.

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
| `cd apps/browser && npm run test:native` | Pass: 3/3 | Exercises the exact download persistence function used by WKDownloadDelegate; normal records persist exact source/filename while Private completions write no metadata |
| `cd apps/browser && npm run gate:source` | Pass | Scans Browser production source trees for deployment filler, fake-success markers and common embedded-secret patterns |
| `cd packages/web4-permissions && npm test` | Pass: 15/15 | Covers all four exact Browser tuples, callback/scope/chain/replay rejection and the non-exportable Windows CNG builder boundary |
| `cd apps/browser && npm run verify:macos-reproducible` | Pass | Two complete same-host builds produced ZIP SHA-256 `df24eb70667572b3122137f41883bc9d6b02bec8e7728e727b44bcb09cc176ce`; cross-host reproducibility is not claimed |
| macOS Testnet Preview package | Pass | ad-hoc-signed app and integrity-checked ZIP created; 109273 bytes; executable SHA-256 `822947dd8a9146e66274d3ebce1ff56d2e3e2a476493d8069611d7d88e9769dc` |
| macOS cold start / quit / restart | Pass | Packaged app started twice, exposed `YNXBrowserNative`, and exited cleanly after each run |
| macOS signing boundary | Truthfully non-production | `codesign` verification passed as `adhoc`; Gatekeeper rejected it; no Developer ID, notarization, hosting or store claim is made |
| Windows WPF build at current commit | Blocked before compile | `dotnet` is absent from this macOS workspace; no Windows build/package/install claim is made |
| Other platform install/cold-start | Not rerun | Historical evidence remains historical and is not automatically attributed to this commit |
| Public deployment/artifacts/signing | Not verified | Public, hosted, production-signed and store states remain false |

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

Extract and test the macOS preliminary Wallet callback validator for malformed input, unknown fields, expiry, Nonce, Chain ID, Product Client ID, Bundle ID and replay. Then exercise the `ynxbrowser` protocol path on the built app while keeping Product Session creation fail closed until Gateway signature and device-challenge verification. Separately record the full normal/Private WKWebView plus NSSavePanel download interaction, then wire state-v2 export/delete/backup/restore controls into native clients. In parallel, run Windows CI with .NET 8 to compile/package the CNG Wallet builder, register the callback protocol and execute replay/tamper/expiry tests before central Wallet/Auth acceptance.

## Blockers

- macOS native download persistence policy is tested, but the full WKWebView/NSSavePanel normal/Private interaction and the `ynxbrowser` callback interaction are not yet captured.
- Central contracts and shared Testnet endpoints are not yet accepted in this branch.
- Windows build, full Xcode/simulator, production signing, notarization, store release, hosted downloads and public `/browser` proof remain unverified.

No secret, signer, payment, transaction or Wallet private key is requested or stored by this handoff.
