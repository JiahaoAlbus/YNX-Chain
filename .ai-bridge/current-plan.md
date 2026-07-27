# YNX Browser current plan

Updated: 2026-07-27  
Branch: `codex/final-browser`  
Goal: Active  
Phase: FREEZE

## Protected checkpoints

1. `06fb7ee7e321743288348feefa3fb76e9f096463` — bind macOS download attribution to the initiating tab and exclude Private metadata.
2. `91685b728cefefabec9414317f2663d659062edc` — state schema v2, migration, rollback backup, corruption recovery, export/delete and backup/restore core.
3. `0515ff50b22547840c6554b29c4af3cd17484800` — Windows non-exportable CNG P-256 Wallet request builder and callback envelope.
4. `899f69822d17ff707afb2a7112feacdc21c5253c` — prior macOS release evidence, pushed and remote-equal.
5. `668cb44dab95374ba9e5342d754b6ec568564f2b` — shared native download persistence policy, 3 native tests, production source gate and removal of the `example.com` runtime fallback.
6. `f2f9aaed8d3e4231d37c94de352077008a338572` — deterministic macOS ZIP packaging and same-host two-build reproducibility gate.

Local and remote `codex/final-browser` are equal at `f2f9aaed8d3e4231d37c94de352077008a338572` before this evidence-only update.

## Verified at the current source checkpoint

- `cd apps/browser && npm run check`: pass.
- Browser Node tests: 14/14 pass.
- Native Swift download-persistence tests: 3/3 pass.
- Browser Smoke and production source gate: pass.
- Web4 permission/Wallet contract tests: 15/15 pass.
- Same-host macOS preview reproducibility: two builds, identical ZIP SHA-256 `df24eb70667572b3122137f41883bc9d6b02bec8e7728e727b44bcb09cc176ce`.
- ZIP: 109273 bytes; executable SHA-256 `822947dd8a9146e66274d3ebce1ff56d2e3e2a476493d8069611d7d88e9769dc`.
- App cold start, graceful quit and restart: pass.
- Ad-hoc code-sign verification: pass; Gatekeeper: rejected, so production signing/notarization remain false.

## Immediate sequence

1. Extract the macOS preliminary Wallet callback validator into the native core and add malformed, expiry, nonce, chain, client, bundle, unknown-field and replay tests.
2. Exercise the `ynxbrowser` protocol path on the built app and preserve the rule that no local Product Session is created before Gateway and Wallet/Auth verification.
3. Record a full normal/Private WKWebView plus NSSavePanel download interaction; keep it distinct from the now-complete deterministic persistence-policy evidence.
4. Wire state-v2 export/delete/backup/restore controls into native platform UIs and run installed restore drills.
5. Run Windows CI on a Windows/.NET 8 host; compile/package/install, register `ynxbrowser`, and execute nonce/tamper/expiry/replay vectors.
6. Submit the four Browser tuples and vectors to 02 Wallet/Auth; remain fail closed until accepted.
7. Continue privacy-safe observability, retention/service-exit policy, SLO/capacity, SBOM/provenance and supply-chain evidence.

## Truth boundary

- Product-wide `testedLocal` remains false because Windows, iOS, Android final-branch and cross-product gates remain open.
- Native download policy tests prove the exact persistence function used by WKDownloadDelegate; they do not prove a completed network download and Save Panel interaction.
- The macOS artifact is locally built, reproducible on the evidence host, packaged and executed, but not installed to a user application location, hosted, notarized, production signed or store released.
- Central integration, shared Testnet and public release remain false/unverified.
