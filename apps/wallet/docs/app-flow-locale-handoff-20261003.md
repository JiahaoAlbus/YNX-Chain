# Complete App flow copy module for A's single-writer composition

Source base: 62ea03774c24b03f0809b42b554c7a399736ca51. App is unchanged exact A guarded-reopen SHA256 963440f27c71144040ec6b17cd613ce87d6431ff2aa2b3ee82ac867ff7caf52f. This batch writes only owned i18n modules, tests and this receipt. App/startup assets, package/version/certificate, shared SDK/registry/authority, Host, installed accounts/keys/journals and all immutable source freezes remain untouched.

## Coverage and API

All 124 unique visible English branches from the six current c(en,zh) wrappers are covered, including nested conditional branches: receiving, saved transfer history, old receipts/recovery, unsigned invoice reference review, signed Pay review/history/recovery and native contract reads. appFlowSource.ts preserves every exact English key and Simplified Chinese phrase from the frozen A App. Separate Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Russian, Arabic and Indonesian phrases are explicit in the three flow tables. There is no translation service, English fallback for selected non-English locale, protocol rewriting, account/session material, or new payment authority.

Import from `src/i18n/appFlowCopy`:

```ts
import {walletAppFlowCopy} from "./src/i18n/appFlowCopy";
// A alone replaces all six wrappers; original calls/conditionals stay unchanged.
const c=(en:string,_zh:string)=>walletAppFlowCopy(locale,en);
```

`walletAppFlowCopy(locale:WalletLocale,message:string):string` accepts only the fixed catalog. Unknown text or invalid locale throws a generic error without including the input; it does not silently fall back or accept dynamic merchant/address/hash values. `WalletAppFlowMessage` is the exact exported key union. `APP_FLOW_MESSAGES` and `allWalletAppFlowCopy()` expose only fixed, frozen public copy for checks. Literal token strings such as YNXT, 0x and pure/view remain intact. Text is plain strings: no replacement font size, maxFontSizeMultiplier, forced LTR or UI scaling behavior is introduced. Existing App wrapping, OS font scaling, touch targets and per-locale RTL remain A's composition/layout responsibility.

The copy retains original-only checking/settlement, independent protected policy/current session/business validation, unknown outcome never permitting another payment, persisted original evidence, local snapshot versus consensus finality, partial device-local history, explicit separate review/approval, and bounded read-only contract behavior. Source text checks are not proof of the business/runtime capability described by those notices.

## Verified scope and remaining work

Current isolated admitted-SDK955 Native candidate: all i18n targets plus actual reopen and signed modal boundary targets 48/48 PASS, zero failures/cancellations/skips; tsc --noEmit exit 0. Log: /tmp/ynx-wallet-android-inheritance-clean-test-20261003-1ZEdhW/apps/wallet/app-flow-copy-composition.log, SHA256 75db9535d6aa75dfd7abe7494fb505e0045aba0aede3afacb90495b980725665. Final typecheck log: app-flow-copy-typecheck-final.log. No unchanged large suite or export was rerun: the new module is deliberately not yet imported by locked App, so an unchanged Hermes export would not prove its adoption.

Four new tests verify 124 × 12 complete/nonempty/explicit/non-English copy, exact current App literal/conditional coverage and unchanged zh-Hans, unknown/prototype/invalid-locale refusal, and selected safety clauses/protocol tokens. The initial targeted run had three PASS and one bad test heuristic FAIL: a correct Traditional Chinese notice was exactly 30 characters and rejected by a >30 length assertion. app-flow-copy-targeted.log preserves that failure. The heuristic was replaced with explicit per-language no-repeat clauses; no translation was lengthened merely to pass. Source coverage inspects literals, not the whole future App hash, so A's authorized wrapper/import change is not rejected solely for changing that hash.

NOT_VERIFIED: A wrapper adoption and resulting whole dependency/source composition, actual rendered RTL/OS font scaling/truncation on installed Android/iOS/macOS/Web, native-speaker review, OS protected ports, public business payment/settlement, formal forward installers/website install/user journey and MONSTER. Other existing walletCopy DETAIL_MESSAGES still provide only en/zh-Hans/ar; this scoped 124-key module is not a claim that every unrelated Native screen is already twelve-language complete. Continue the full original goal; these are pending implementation/integration gates, not completion exemptions.
