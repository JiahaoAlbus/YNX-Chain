# Ordinary Quant idle cash readback

Predecessor `0444701bea5470e936bf178d3d7326195859686e` contains the
observed-bar cash mean implementation. This successor displays reported
averageIdleCapital in the existing research details and explains the exact
idleCapitalSamplingPolicy in all12 languages, default English. It does not
recompute cash or run research on a locale change.

Only `observed_bar_cash_mean_truncate_micro_v1` receives the new explanation:
warmup/no-fill observations included, micro-units truncated toward zero,
not time weighted, no invented missing bars or interest. Legacy/unknown policy
explanation stays unavailable. A valid historic source amount may still display;
unknown policy is not silently relabeled. Missing/unsafe/noninteger amounts or
wrong currency remain unavailable, while actual zero/negative cash remain valid
reported values under existing simulated short-sale semantics.

Executed Node syntax, diff whitespace,56business cases PASS0FAIL/0SKIP
(320.751167ms). New business gate exercises actual source controller response
and all locales, old/unknown policies, invalid amounts, zero and negative cash.
Initial fixture used a nonexistent locale helper and failed; corrected to the
existing actual locale change handler, then the complete suite passed.

Actual Chrome full browser suite22/22PASS0FAIL/0SKIP46.405s. Includes mobile
all-language formula/details layout, missing attribution recovery, page/tab
stability and existing guest, Paper, risk, schedule, kill and fallback flows.
New browser assertions insert controlled attribution into the existing test
result and render the production details; this is display QA, not real market
data, canonical account/private approval or public/installed acceptance.

No shared authority, grants, production or DB changes. Ordinary app/index hunks
must merge into the release owner's current coherent formal graph and asset
pins; this older checkout is not a deployable formal replacement. No public
source-bound acceptance claimed. Source rollback can remove only these display
hunks without changing retained research records.
