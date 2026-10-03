# Exchange identity response recovery — 2026-10-03

Branch `codex/exchange-sso-cookie-binding-20261002`; predecessor `b4796348c620d2836e7f129d0a5829701f613034`.

Ordinary Exchange page changes only. Existing shared Wallet/SDK/Auth, grants, release pins and deployed runtime are unchanged.

## Behavior

The existing identity request helper now enforces a five-second fetch/body settlement deadline, even if abort is ignored. Its fixed relative config/account/logout paths are checked before any fetch. Credentials remain same-origin and cannot be overridden; responses are no-store and redirects are rejected. JSON media type/object shape and declared/buffered 262144-byte limit reject HTML fallback, corruption and oversized responses. The body bound is after buffering, not a streaming memory guarantee.

Keep original CSRF, method, body and identity/private-workspace separation. No automatic logout replay, no new write grants, no synthetic authorization. Existing logout state machine remains unchanged: timeout is unconfirmed, current identity remains until a confirmed explicit retry, and late old results cannot overwrite a new operation. The historical source-only release scanner binds the exact revised helper SHA rather than allowing arbitrary fetch implementations; its business-route negative tests still fail closed.

## Actual results

- Identity response, owned-controls Chrome, release scanner and 12-language Chrome regression: **34/34 PASS**, no skips or cancellations, 29676.73325 ms. This includes the additional real Chrome five-second timeout followed by explicit retry; no implicit second POST, no false disconnect, one tab.
- Node syntax and `git diff --check`: PASS.
- Expanded existing `npm test`: **79 PASS, 4 FAIL, 1 SKIP**, 84 total. This is not a full suite pass. The skip is the opt-in isolated Go/controller HTTP QA.

Preserved failures: three old UI assertions reject the already-existing locale preference localStorage or assume the already-multiline quiet identity function fits a single-line regex; the fourth is a real stale static graph (`EXCHANGE_ASSET_HASH_MISMATCH:styles.css`). The existing graph also omits locale.js from its tracked module list. No stale gate was removed or relaxed to claim completion. The predecessor already contains public locale storage, multiline quiet recovery and the old graph; this checkpoint adds neither a credential store nor another automatic navigation.

## Handoff

The sole release owner must refresh and verify the coherent Exchange asset/import graph including locale.js, together with accepted shared dependencies; ordinary owner must not overwrite formal graph/pins. The revised helper exact SHA256 is `8953bb911714c9327690c25adf02d8415cdf91e0b2ade3dd7a5b7318a1e2f328`.

Send unresolved items only to `接续测试网生态审计工作`, thread `01a094cc-0ba3-7901-bcd5-56fce8330c0d`. Public deployment, real browser account/session approval, installed flows, writes and trading remain NOT_VERIFIED. Controlled Chrome HTTP routes prove page recovery only, not remote revocation. Ordinary account-write action permissions remain separate prerequisites, never implied by read or identity scope.

No deployment occurred, so no public rollback is necessary. Release integration must preserve its previously signed complete artifact until the new coherent graph passes; do not mix current page source and stale asset identities.
