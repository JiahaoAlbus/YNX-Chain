# Existing task / order / fill trace — ordinary local source

Source: 634254f25d9292de9e3f059475a9b24f8b4054df
Tree: 74a6d3d3031e00580c0cdeeb57e5a68b65a98615
Predecessor: dab352a47e5353af412b7d753b185c8a72f85910
Branch: codex/exchange-sso-cookie-binding-20261002

## Completed inherited product flow

The Activity advanced-orders tab now has a real local read-detail action.
It opens the selected owned conditional/OCO/TWAP/Scale task, original
parameters and source times, related owned ordinary orders and owned fills
whose buy/sell order references actually match the task references.
It displays actual order status, amount/filled amount, price, fee and source
digest. No aggregate fill is invented and no task status is translated into
chain settlement. Source *Micro fields retain exact raw integers alongside
their explicitly labeled display conversion.

Missing related records are labeled absent from the current snapshot,
not successfully filled. References and reason text stay literal. This
adds no order, cancel, approval, API, signing or permission endpoint.

Detail selection is rebound to the current snapshot/owner on rendering.
Old detached buttons cannot open a retired owner's task. Account change,
private read retirement and absent tasks close and erase the dialog.
Escape/close erase sensitive visible state and restore focus to the current
owned task button. A delayed close event cannot erase an already reopened
dialog. Locale switching updates the open dialog/title and accessible close
label without mutating original records. Twelve existing locales remain.

## Executed verification

- Actual Chromium product HTML, renderer, tab/button handlers, native modal,
  locale module and the actual private-account retirement renderer:
  focused PASS, 1622.946 ms (includes final accessible-label patch).
- Combined owned-controls-browser, locale-browser and private-account
  suites: 59 PASS, 0 FAIL, 1 deliberately opt-in isolated Go/Chromium test
  skipped; 25491.903833 ms. This run precedes only the accessible-close-label
  patch; the final focused run exercises that patch across all 12 locales.
- node --check for app.js, locale.js and owned-controls-browser.test.mjs:
  PASS. git diff --check: PASS.
- Fixture directly verifies related order/fill status, exact fee and digest;
  foreign owner records and unmatched order references are not exposed.
  Literal markup creates no image or script. Dialog fits the 390px viewport.
  Account switch and actual guest retirement erase both title and contents;
  captured retired button cannot reopen it. Escape returns focus.
  Records remain byte-equivalent; network request count is zero.

Fixtures intentionally use controlled account snapshots, not signed public
data. No provider account request, Wallet approval, callback, sign, EIP-712
or testnet send was performed. No Go/backend source or persisted state
changed, so this UI change does not claim a new engine/PG test result.

## Matching release boundary

This is local ordinary source/UI evidence only. Public, installed,
canonical private-session, real account approval/order/chain operation
remain unproven. Existing old formal SDK entry still requires A's matching
accepted createBusinessProof SDK/source assembly; this consumer change
neither replaces shared protocol nor widens scopes. Formal bundles/pins,
Host, build/install/deployment and protected composition are unchanged.

The current source must be included with the prior dual-proof consumer and
advanced-record validator when A assembles the matching release. Report
the resulting exact runtime separately from these controlled tests.
Coordination target: 接续测试网生态审计工作,
01a094cc-0ba3-7901-bcd5-56fce8330c0d.
