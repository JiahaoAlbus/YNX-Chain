# Quant response admission and saved-intent recovery

Source predecessor `af172f0e19f0c16b40cd37bcde5fe37b94dd46c6`, tree `d4864a55e9076e517c8e7ac65a8c991691d08614`; branch `codex/exchange-sso-cookie-binding-20261002`.

## Product change

Ordinary Quant API transport rejects Content-Length declarations that are negative, fractional, exponent-form, nonnumeric, unsafe integers or above the existing 8 MiB byte limit. Rejected response headers explicitly cancel the body before acquiring/reading it. Native streamed reads recheck cancellation immediately after each awaited read. Missing length and valid decimal declarations retain compatibility. No request route, credentials, permissions, Wallet/Auth/SSO/proof or formal release graph changed; no automatic POST replay was introduced.

## Executed evidence

- Business-flow test file: 92/92 PASS, 0 skips/failures, 543.729042 ms. New native Response tests cover seven invalid declaration classes, zero body pulls, one cancellation/one request, and valid absent/decimal/zero-padded declarations.
- Actual local Chrome selected regressions: 3/3 PASS, 0 skips/failures, 4824.115791 ms. Native stream UTF8 and oversize handling remain valid. Invalid header keeps one exact uncertain saved research intent, hides unconfirmed results, and language change neither replaces intent nor retries. Existing localized service-failure recovery passes. One tab and no pageerrors observed in the added case.
- Actual local Go + two independent browser contexts: `node --test apps/quant-lab/tests/research-recovery-browser.test.mjs`, 1/1 PASS, 7605.023375 ms. Saved research isolation/lost-return/restart and the existing Paper/risk workflow execute against the real product engine with a controlled local tape. Three clean SIGTERM stops occur.
- Retained isolated run: `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-1J5iWO`. Local Go binary 11467122 bytes, SHA256 `46f3c56533cf6712cd0c8a2be23a5ba3dda26f58dc743d1edb047b1a13ccb7d8`.
- Node syntax and Git diff checks PASS.

## Acceptance boundary

Actual browser/product process tests use isolated generated preview tenants and controlled tape, not public prices, human approval, native installation, production database or real capital execution. The binary is a local test build, not an installer or formal release. PublicVerified=false and WalletApproval=false. Existing public/runtime integration and PostgreSQL multi-instance gaps remain; formal shared bundle/build/pins/deployment belong to the release owner and were not changed.
