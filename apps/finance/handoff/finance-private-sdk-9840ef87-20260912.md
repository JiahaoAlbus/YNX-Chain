# Finance private Wallet SDK source checkpoint

This continues Standard checkpoint `3994c15958ab30cc250970b8800c28929313f3d1` (tree `044979590cb88e119b3c195389fb5df86071846b`) on `codex/finance-wallet-flow-20260912`. Source/local tests only: no SSH, production writes, installed Wallet, user account permission, real signature or transaction.

## Exact dependencies

- Browser source `9840ef871165eb523c4e7a3d48964dd25f8dee8e`, tree `4b3d86ea4bf98481a9448c694eb022b33cd36679`.
- `web/vendor/product-session-browser-9840ef87.mjs`: 214746 bytes, SHA256 `5dc94d97925e4c0271c8c45255e0e409f257258e4e621f71fda26c4e2407a6e0`.
- Registry: 7546 bytes, SHA256 `85c6995eddfbc175efaac01dbad31a4f5ef8878aab91613da2d689ef79921ab3`.
- Standard standalone c97 artifact remains byte-identical (22417 bytes / `b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43`).
- Shared Go source `0b3761f903ffd5dee6367e49c613cfd8752d7562` inherited with ordinary `cherry-pick -x` as `65c23d11a784d3df944506072a6466ad28a363b4`, tree `ac2f05928910b27877a34d42626fda4f347585e3`. All five `internal/productsessionv2/**` blobs match; no shared modifications.
- Combined built Web bundle: 149577 bytes, SHA256 `bfeeade2946dbc1f9f51b8752cc83a465eceb9b3a8690583e27f56caa91e2048`.

## New authority boundary

The browser imports `createBrowserProductSessionClient` and `ProductSessionGatewayFetchAdapter` from the same frozen ESM. Authority is exactly `https://wallet-auth.ynxweb4.com`; product finance, client ynx-finance-v1, web application com.ynxweb4.finance.web, origin `https://finance.ynxweb4.com`, callback `/wallet-auth/callback`, native bundle/package null. Explicit approval lists portfolio/Pay reads, planning writes and user-requested AI draft permissions. It is not asset execution.

Guest makes no new private device. Explicit begin uses SDK `beginExplicit` and exposes only its exact saved route as a user-click link, never automatic navigation or a blank new tab. Native installation stays unverified. SDK WebCrypto keys are non-extractable; old unbound/other-authority records are preserved, never read into new credentials or migrated/deleted. The same pending request survives a second tab and reload. A complete callback goes through `handleReturn`; a cleaned callback page refresh goes through `restore`, not a second empty callback. API calls request a new introspection proof for each attempt; a proof is not consumed in the browser before the product API. Account/connection revision fences reject late replies. Failed private logout retains SDK revocation intent and offers Retry; no false local logout is claimed. Standard Wallet stays independent.

Finance Go defaults to explicit `YNX_FINANCE_AUTH_MODE=product-session-v2` (also the absent-variable default), with fixed authority/policy and the unchanged shared `Authorize` implementation. Scope is chosen from the server route, never request data. Legacy `X-YNX-Product-Session-Proof` is rejected in this mode. Old completion/revoke proxy paths return 410. `/api/auth/logout` cannot claim Wallet revocation and returns 409 in v2 mode. New private outages are typed 503, expired/rejected are 401 and binding/scope failures are 403. Legacy-v1 remains an explicit separate configuration for its original authority; it cannot silently point to the new browser authority. No production configuration changed.

## Executed local checks

- `npm test` from `apps/finance`: **35/35 PASS**. Includes 13 Standard actual-Chrome cases, 5 non-sensitive private storage/return cases and 3 offline official-kernel cases; other inherited contracts retained.
- `npm run security`: PASS (330 text files). Two non-visible noble TODO comments are exempt from placeholder detection only when the entire immutable SDK hash matches; credential rules still run.
- `go test -race ./internal/productsessionv2 ./internal/finance ./apps/finance/cmd/...`: PASS. The shared package tests its genuine SDK vector; Finance tests typed rejection, exact route scopes, native account isolation, restart persistence, replay/unavailable handling. Tenant decision fixtures are expressly not cryptographic proof.
- `npm run build:wallet` in `apps/finance/web`, Node syntax and `git diff --check`: PASS.
- `tests/fixtures/wallet-test-kernel-9840ef87.mjs` is an offline build of official source, 119170 bytes / SHA256 `5f711edad9a4ade05d3bc2353ac989ae4c1465cfb79b50e4bc600f1af4f70bd1`. Builder reads immutable Git source objects even if another Wallet owner has newer dirty changes. It is not shipped in the Web runtime. Disposable local test scalars exercise actual approval/challenge/proof/replay/revocation; there is no real user account or public authority claim.

## Remaining work / rollback

Public source-bound release, installed/native Wallet open, real user approval/rejection, WalletConnect and real business/testnet execution remain false. Full Web localization and the existing `budgetProgress` display remain next owner work; mobile translations are untouched. No prior lease is reusable. A future Central deployment needs this exact candidate/config/rollback mapping and fresh authority. Source rollback is a reviewed normal revert; no runtime has been mutated by this task.
