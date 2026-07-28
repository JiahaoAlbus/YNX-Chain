# YNX Browser current plan

Updated: 2026-07-27
Branch: `codex/final-browser`
Goal: Active
Phase: FREEZE

## Protected checkpoints

1. `06fb7ee7e321743288348feefa3fb76e9f096463` — bind macOS download attribution to the initiating tab and exclude Private metadata.
2. `91685b728cefefabec9414317f2663d659062edc` — state schema v2, migration, rollback backup, corruption recovery, export/delete and backup/restore core.
3. `0515ff50b22547840c6554b29c4af3cd17484800` — Windows non-exportable CNG P-256 Wallet request builder and callback envelope.
4. `668cb44dab95374ba9e5342d754b6ec568564f2b` — shared native download persistence policy, three native tests, production source gate and fail-local Search fallback.
5. `f2f9aaed8d3e4231d37c94de352077008a338572` — deterministic macOS ZIP packaging and same-host two-build reproducibility gate.
6. `2bfbbb49b3c922d57efd303ebaa1aa15a4f94937` — native privacy/artifact evidence and integration truth update.
7. `d9580e6b9d09a9d2eec69fbcb6d35a9ddf6997ed` — signed macOS pending Wallet state, strict callback validator, byte limits and fail-closed negative vectors.
8. `bde6939223693d5cdf5d05f309ac888c091ab815` — privacy-safe native OSLog error/audit events with source gates against browsing-data leakage.

Local and remote `codex/final-browser` are equal at `bde6939223693d5cdf5d05f309ac888c091ab815` before this evidence-only update.

## Verified at the current source checkpoint

- `cd apps/browser && npm run check`: pass.
- Browser Node tests: 14/14 pass.
- Native Swift tests: 20/20 pass, comprising 17 Wallet callback tests and 3 download-persistence tests.
- Browser Smoke and production source gate: pass.
- Web4 permission/Wallet contract tests: 15/15 pass.
- Current Dist `ynxbrowser` protocol probes recorded `MALFORMED`, `ROUTE`, `DUPLICATE` and `STATE-MISSING` through privacy-safe OSLog events.
- Wallet pending state is signed with the product-device P-256 key and bound to Nonce, expiry, chain, product, client, bundle, callback, algorithm and ordered scopes.
- Strict top-level query/JSON validation rejects unknown, duplicate, escaped-duplicate, wrong-type, malformed and oversized input.
- Same-host macOS preview reproducibility: two builds, identical ZIP SHA-256 `fa22ac3924f68f25658257b42341f5af44274a5faa8ceceb57a2a76ef94bf2f7`.
- ZIP: 138216 bytes; executable SHA-256 `cae76c48e0acb8241f3501115cee118865c3d2b54ee945b7091d4894208943a9`.
- App cold start, termination and restart: pass.
- Ad-hoc code-sign verification: pass; Gatekeeper: rejected, so production signing/notarization remain false.
- A source-mismatched user Applications copy with the same bundle identifier was detected and excluded from current-source evidence.

## Immediate sequence

1. Add a non-destructive macOS install/evidence workflow that detects same-bundle collisions, preserves the existing user app, installs the reviewed artifact under an immutable evidence name, registers it explicitly, and verifies the resolved executable hash.
2. Complete a centrally accepted positive Wallet/Auth callback with Gateway signature and product-device challenge verification; no local Product Session creation is permitted.
3. Record a full normal/Private WKWebView plus NSSavePanel download interaction; keep it distinct from deterministic persistence-policy evidence.
4. Wire state-v2 export/delete/backup/restore controls into native platform UIs and run installed restore drills.
5. Run Windows CI on a Windows/.NET 8 host; compile/package/install, register `ynxbrowser`, and execute nonce/tamper/expiry/replay vectors.
6. Submit the four Browser tuples and vectors to 02 Wallet/Auth; remain fail closed until accepted.
7. Continue cross-platform privacy-safe observability, retention/service-exit policy, SLO/capacity, SBOM/provenance and supply-chain evidence.

## Truth boundary

- Product-wide `testedLocal` remains false because Windows, iOS, Android final-branch and cross-product gates remain open.
- Local negative callback validation is proven, but no accepted Gateway signature, device challenge, approval, revocation or central Product Session is proven.
- Native download policy tests prove the exact persistence function used by WKDownloadDelegate; they do not prove a completed network download and Save Panel interaction.
- The macOS artifact is locally built, reproducible on the evidence host, packaged and executed, but the exact current source is not installed or unambiguously registered with LaunchServices.
- The artifact is not hosted, notarized, production signed or store released.
- Central integration, shared Testnet and public release remain false/unverified.
