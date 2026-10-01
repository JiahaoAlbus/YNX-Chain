# Bounded SSO recovery source handoff

This is source/local isolated QA evidence, not public installed Wallet approval or owned-business acceptance. Extract only this successor commit; its branch parent contains the separately frozen Quant Paper backend, which is not part of this SSO change. The two untracked Paper consumer files remain paused.

## Changes and boundaries

- Central issuance previously produced a session-only `__Host-` identity cookie. Within a constant valid server clock, Chromium retained it in another tab but discarded it after closing and reopening its persistent browser process. Issuance now uses `Max-Age=7200`, matching the existing absolute server lease. Secure, HttpOnly, host-only, SameSite=Lax and Path=/ are unchanged. Status/bootstrap reads do not renew this cookie. Server idle 30 minutes, absolute two hours, transaction 120 seconds, revoke and account-generation checks remain authoritative.
- Finance previously abandoned quiet recovery while private startup was checking/connecting, without retrying after settlement. Exchange abandoned its captured private/standard context when private initialization changed during the configuration fetch. Each now records deferred recovery and performs a fresh server recheck after actual settlement. The original context/revision comparisons remain; superseded identity reads cannot schedule competing rechecks.
- Explicit browser sign-in and opening the Wallet chooser invalidate the queued quiet intent. Connect-only still does not sign, approve identity, request private scope or select a provider. A document that has taken an explicit Wallet interaction does not later navigate silently over that interaction.
- Existing pending private approvals and unconfirmed revocation are not deleted. These tests do not claim the new public 7e saved-request/native-installation observation is fixed.

## Reproduction and regression

Run from repository root. The existing ecosystem browser runtime requires the locked dependency installs in `packages/wallet-auth`, `apps/quant-lab` and `apps/finance/web` (normal `npm ci` in each). No new published SDK runtime dependency is introduced. The three Chromium cold-browser tests explicitly opt into that ecosystem runtime; ordinary isolated SDK tests do not import it.

```sh
YNX_CENTRAL_BROWSER_COLD_QA=1 node --test packages/wallet-auth/test/central-browser-session.test.mjs packages/wallet-auth/test/central-browser-session-daemon.test.mjs
node --test --test-name-pattern='quiet identity recovery resumes|explicit Finance browser sign-in owns' apps/finance/tests/local-product-session-cross-service.test.mjs
go test -race ./internal/exchangeproduct ./internal/finance -run BrowserSSO -count=1
git diff --check
```

Central/daemon: 14/14, zero skipped. This includes actual NodeHost HTTPS-origin socket relay and Chromium same-process new tab, full process restart, idle expiry, absolute expiry and global revoke, plus unchanged CSRF, PKCE, code/replay, durable store and historical daemon-state gates. Only the initial isolated native QA consent completes once; cold recovery performs no new signature or approval.

Consumer: five actual Gateway + Go + Chromium cases, zero skipped. Finance recovers identity-only at the original `#planning` after a delayed real authority-config startup settles. Exchange recovers at `#assets` after a delayed real ProductSession time/config bootstrap settles. Real callback/code/PKCE and product cookies are used; no mocked identity-success response. The pre-fix immutable consumer counterfactual is available with `YNX_SSO_QA_BASELINE=1` and intentionally fails the two settle cases: no `/sso/start` follows settlement and identity remains guest. This is a controlled interleaving reproduction, not a claim that every public failure has the same cause. Existing immediate explicit sign-in cases and late-config-versus-open-chooser also pass.

The new Exchange QA server mounts the same `/sso/start` and `/sso/callback` bridge routes as the actual Exchange runner. Its startup-only Go test skips without the explicit local socket environment; the browser cases launch it with that environment and exercise real HTTP. Its socket mapping accepts only exact official Gateway request origin and an isolated loopback listener.

Go BrowserSSO race tests: Exchange and Finance both pass. Existing product logout suppression, wrong/duplicate callback state, expiry, linked ownership and revoke boundaries are retained. Identity recovery returns only `identity:read`, `privateWorkspaceAuthorized:false`, with zero new native ProductSessions; private service authorization remains separate.

## Generated/runtime handoff

This bounded lease does not write generated bundles, cache pins or deployments. The unique Wallet/release owner must rebuild the central browser bundle from the changed central source, update Finance and Exchange app cache hashes, then freeze the complete exact transitive Finance graph/candidate pins against the integrated source. Do not call an old pin valid for these new bytes or weaken tamper guards. Preserve original server state, cookie encryption keys, issuer, registry, idle/absolute expiry and authority checkpoint.

PUBLIC new-process recovery, same-process Exchange recovery, final installed approval and corresponding owned services remain NOT_VERIFIED until the integrated compatible runtime is tested. Root's earlier public category/closure success and saved-request observations are separate receipts, not promoted by these local tests.
