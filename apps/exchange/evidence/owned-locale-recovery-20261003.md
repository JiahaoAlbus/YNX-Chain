# Exchange locale navigation and connection recovery

Inherited baseline: 8afde49a256720b7604ed0dd30dd6a4be59aa969. Interrupted untracked locale draft was preserved and completed, not restarted.

The inherited Exchange Web page had no language selector. This owner-only batch supplies the same 12 locale IDs as the existing Exchange mobile catalog: en, zh-Hans, zh-Hant, ja, ko, es, fr, de, pt, ru, ar, id. The new product catalog has 20 explicitly translated keys in every locale, without partial-catalog English fallback for these keys. Native/Web state semantics differ, so mobile financial messages were not blindly substituted or its existing catalog overwritten.

Integration covers the four main navigation labels and every existing private-account phase, selected-provider pending review, market loading/live/single-host/polling/reconnect/offline/unavailable messages. Current messages change immediately when the language changes, and later async state results use the current language. Exact technical error codes remain unchanged as suffixes. Standard Wallet/private permission distinctions, no-order/no-withdraw permission, unverified native installation and pending approval remain stated in every translation.

Default language is English; unsupported preferences fall back to English. Only `ynx-exchange-language` is persisted. Blocked preference storage does not block the UI. Arabic sets RTL; other locales restore LTR. Language changes rerender existing public/account values but perform no API, provider, approval or session retry. Amounts continue through exact micro arithmetic. No account key, token or approval payload is stored as a preference.

Validation:

- JS syntax and diff whitespace checks passed.
- Combined locale/owned-controls/private-account/market/order-preview suite with `YNX_EXCHANGE_CONTROLLER_HTTP_QA=1`: 52/52 passed, zero skips, 7.192 seconds.
- Actual local Chrome exercised every locale/phase and late state arrival; language change updated an already-displayed failure without another request. It checked unchanged standard identity, exact code, second initialization, blocked storage, 44px selector and 390px RTL/LTR containment.
- Actual local Go/Chrome host-only identity/logout boundary remains covered by the opted-in suite; no public account or real Wallet approval is claimed.
- Go race exact-byte/JavaScript MIME and versioned-asset serving tests, now including `locale.js`, passed in 1.361 seconds.

Successor batch inherited 8013bd094f20a41e440980c79302a4b31d06a415 without restarting its catalog. Ten exact preview/permission error codes now have explicit messages in all 12 locales: DECIMAL_INVALID, RULES_INVALID, RULES_STALE, SIDE_INVALID, PRICE_LIMIT, AMOUNT_LIMIT, ZERO_QUOTE_UNSAFE, NOTIONAL_LIMIT, FEE_INVALID and API_UNAVAILABLE. The catalog now contains 30 keys. Technical codes and test-asset/range limits remain unchanged; permission failures explicitly state that no request was sent. Unknown errors are not relabelled as known failures.

The actual preview/estimate renderer and toast use this catalog. Corrected input forgets the old tracked error; a newer plain toast forgets the prior localized message, so switching languages cannot resurrect an obsolete permission failure. This changes no arithmetic, permission, order, signature or network behavior.

Successor validation: focused preview/locale tests 10/10 passed; combined opted-in locale/owned-controls/private-account/market/order-preview suite 53/53 passed, zero skips, 6.210 seconds. Actual local Chromium ran the real preview engine and extracted application renderers across all locales, checked precise code preservation, late stale-rule errors, corrected-input clearing, unknown-error refusal and obsolete-toast fencing with zero network requests. JS syntax and diff checks passed. This is local source/browser evidence only, not public or installed Wallet approval.

Remaining work: this is not complete Exchange localization. Other inherited form/help/order-history columns, browser-identity and Wallet strings still need the next ordinary owned translation batch. It is also not a complete product release or installed/public user acceptance.

Release-owner integration requirement: include `apps/exchange/web/locale.js` in the existing runtime archive/static module inventory and coherent versioned asset graph, and pin the new app/index/styles bytes. The owner has not superficially rewritten release cache hashes, modified shared SDK/authority/permissions, or performed Host/publication work. The current packaging script's old fixed file inventory does not yet include this module; release must not be built from that old inventory unchanged. Source rollback is omission/revert of this isolated locale integration followed by the sole release owner's coherent rebuild.
