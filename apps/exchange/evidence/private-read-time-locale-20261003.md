# Exchange private read metadata locale

Owner predecessor 25fd2b28d97ec969ef53fcc21c59dc0247837a88/tree bc2f720481ae1bacc1623f5250f18512b796b138. Ordinary Exchange presentation/tests only. Private adapter, shared Wallet/Auth/SDK/authority, scopes and release pins are unchanged.

Private session expiry and account-source observation time used browser-default Date.toLocaleString and were not re-rendered when the selected Exchange language changed. Added presentation-only renderPrivateReadMetadata using the existing strict RFC3339 ownedRecordTime helper. Existing private state render and actual locale callback both use it. No refresh, approval, identity transition or API request is triggered by language change. Missing/numeric-looking/impossible dates display em dash rather than a normalized date or Invalid Date.

Executed evidence:

- Before fix, actual Chrome context zh-CN with product en failed: rendered `2026/10/3 09:00:00` vs expected `10/3/2026, 9:00:00 AM`.
- Actual owned-controls + locale browser suites: 24/24 PASS, 22194.836625ms. New case uses the real locale installation callback, chooses all twelve Exchange language options, checks expiry and source time against selected locale, byte-identical controlled source JSON, missing/invalid dates as unavailable, zero requests, zero page errors and one tab. Existing cases retain actual account-switch/late-logout fencing, account-bound support drafts, owned activity history, disabled write controls, pending routes, guest clearing and public-market visibility.
- Private-account/owned-record suites: 31 PASS, 1 explicit opt-in isolated Go/Chromium test SKIPPED, total32, 153.621917ms. This does not claim the skipped HTTP cookie-boundary test ran in this checkpoint.
- App/test syntax and git diff checks PASS.

Fixture corrections: renderer slices require their actual owned-time helper definitions; added them to three previously incomplete locale fixture paths (including an inherited controls fixture). New selector test originally used Quant's zh-CN/zh-TW instead of Exchange's zh-Hans/zh-Hant, causing a bounded selector timeout; it now consumes the exported Exchange locale list. No product behavior was changed to mask either fixture defect.

All private states and HTTP outcomes used here are declared controlled local inputs. These checks do not prove public Wallet approval, current-source deployment, real account operations, installed release or production readiness. The separate coherent release owner must integrate only the ordinary changed hunks; do not replace its shared source graph with this checkout.
