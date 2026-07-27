# YNX Browser dependency acceptance

Version: 0.2.2-candidate
Source commit: `f2f9aaed8d3e4231d37c94de352077008a338572`
As of: 2026-07-27  
Status: candidate; no central acceptance is implied

## Acceptance table

| Owner | Required dependency | Browser-side evidence | Acceptance | Remaining gate |
| --- | --- | --- | --- | --- |
| 02 Wallet/Auth | Product registry, Device Challenge, Wallet Approval, Product Session, introspection, expiry and revoke | Four platform tuples and request builders are present; Windows uses a non-exportable CNG P-256 identity and signed pending state; every client preserves the no-signing boundary | Pending | Central registry acceptance, Windows compile/protocol registration, plus real approve/reject/replay/expiry/revoke vectors |
| 14 AI | Browser assist workflow, provider/model/cost state, streaming, cancellation and audit | Local context allowlist rejects Private pages and unavailable providers fail honestly | Pending | Accepted gateway schema and one provider-backed or accurately unavailable end-to-end run |
| 23 Search | Reviewed new-tab endpoint, suggestion provenance, authorized corpus and outage semantics | Platform clients point to the existing Search staging candidate | Pending | Final Search contract, source inventory, TLS/health/rollback and offline/failure proof |
| 26 Data Fabric | Canonical privacy-safe Browser events | Browser has bounded local audit event names only | Pending | Canonical event names, versions, retention and redaction contract; local strings must not be treated as canonical |
| 28 Website | `/browser` public route, metadata, downloads and support/privacy/security/status links | Browser public package has not yet been generated | Pending | Truthful metadata and immutable artifact manifest, then Website publication evidence |
| 29 Integration | Protocol freeze and shared Testnet | Browser contract and cross-product candidate vectors now exist | Pending | Freeze one version and run the shared Search/Wallet/Pay/Quant/DEX/Explorer flow |
| 30 Security/SRE/Release | Threat policy, SBOM/provenance, signing and hosted artifacts | Production source gate passes; macOS ad-hoc preview has integrity-checked bytes/hashes and two same-host builds produce the same ZIP SHA-256 | Pending | Regenerated current-commit SBOM/provenance, dependency/license/SAST/DAST/artifact scans, cross-host reproducibility, production signing and hosted artifact proof |

## Fail-closed rules while pending

- Browser does not create an authoritative Product Session, sign, pay, transact, swap, deploy, change permissions outside the reviewed exact origin, or widen Wallet scopes.
- Missing or rejected central contracts disable the affected integration surface; they do not trigger a legacy or wildcard compatibility path.
- Search, AI, threat and public-release failures remain visible as unavailable, stale, partial or unverified.
- Private browsing data is not exported to central services without explicit selection; Private page content is never sent to AI.
- A downloaded operating-system file can remain after Private mode, but YNX must not persist its Private download metadata.

## Current local blocker

The macOS privacy fix, state-v2 lifecycle and Windows Wallet request builder are committed. Browser tests pass 14/14, native download-persistence tests pass 3/3, Wallet/permission contracts pass 15/15, Smoke passes, and the production source gate passes. The macOS arm64 Release Build, ad-hoc Testnet Preview package, two-build same-host reproducibility, cold start, graceful quit and restart are verified at `f2f9aae`; Gatekeeper rejection correctly preserves the non-production boundary. Windows compilation still cannot start because `dotnet` is not installed. The full macOS WKWebView/NSSavePanel download interaction and `ynxbrowser` callback interaction remain open.
