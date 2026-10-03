# Quant Testnet execution read boundary

Source parent `fe5385be77f1d59d995c898a0f34ca19162cf1a4`.
Ordinary Quant renderer and tests only; no execution, authority or SDK mutation.

Regression first reproduced a null execution row crashing the entire workspace.
Old rendering also showed venue fields independently of the actual stored
`reserved_outcome_unknown` versus `submitted_testnet` state, allowing an unknown
outcome to appear filled when stale/inconsistent venue fields were present.

The renderer now distinguishes unknown container from confirmed empty map,
requires compatible testnet ID/market/side/exact safe positive quantity, and
labels amounts YNXT_MICRO for the sole market accepted by current Go mandates
(`YNXT-YUSD_TEST`). Unknown/reserved outcomes never display venue completion or
authorization evidence. Submitted readback requires the actual service's known
venue states, nonempty venue ID/broker proof and a 64-hex authorization digest.
These checks are source display consistency, not independent signature or chain
verification. Raw status/ID/hash remain canonical machine values.

Unknown/empty/unavailable explanations cover all twelve supported languages.
Invalid rows cannot erase valid rows and raw source data remains unchanged.
No endpoint, scope, permission or automatic retry was introduced.

Evidence:

- New regression failed before fix with null `venueOrderId` TypeError.
- Final business/UI suite 77/77, 422.724542 ms.
- Real Chrome source-controlled history/Testnet/Paper group 3/3, 5717.337041 ms.
- Chrome Testnet case: twelve languages, unsafe/missing/reserved records, reload
  and refresh, exact raw map preserved, zero writes, zero page errors, one tab.
- Missing broker proof/digest/venue ID, unknown status, unsafe/zero amount and
  unsupported BTC market remain unavailable in deterministic regression.
- Syntax and diff checks pass.

```sh
node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/ui.test.mjs
node --test --test-name-pattern='Testnet execution|persisted Paper records|saved research history' apps/quant-lab/tests/browser.test.mjs
```

All records used in the new browser case are explicitly controlled local fixtures;
no capital execution, real order, wallet approval or signature occurred. Public
source-bound publication, authenticated native mandate/proof and actual Testnet
execution still require their independent accepted authority and release gates.
Integrate only ordinary hunks into current release graph; retain formal pins/Host.
