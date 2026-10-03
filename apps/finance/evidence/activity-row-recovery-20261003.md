# Finance owned activity read recovery

Parent: `b92724fec3d0e258ac42d48f10c9948d43bfdcf0`.
Only ordinary Finance renderer/tests/evidence; no authority, grants, SDK or Host.

Actual Chrome reproduced `Cannot read properties of null (reading 'direction')`
for a mixed activity response. The previous summary also rendered every direction
other than outgoing as `+`, inventing an incoming interpretation for unknown data.

The shared ordinary row predicate now requires a record with nonempty string ID,
string type and a known incoming/outgoing direction. Invalid rows are visible as
localized unavailable observations, not removed or selectable AI context. Valid
rows remain displayed, with existing safe-integer amount handling unchanged.
Unknown containers are unavailable, distinct from confirmed empty arrays.
Selected valid AI rows persist across rerender; source objects are not mutated.
This is a display boundary, not a claim of independently validating chain data.

Tests:

- Before correction, new real Chrome regression failed on null row rendering.
- Final targeted regression: 1/1, 1089.259958 ms.
- Full Finance standard-wallet/browser suite: 36/36, 18330.123542 ms.
- Owned save/AI controller regression: 15/15, 60.006709 ms.
- Twelve locales, raw data equality, valid selection preservation, unavailable
  container, zero provider calls and zero page errors verified by the new case.
- `node --check apps/finance/web/app.js` and `git diff --check`: pass.

The new test executes local production page renderers with explicit controlled
records. It does not sign in, request real accounts, sign, transact or publish.
The existing broader wallet suite uses synthetic provider fixtures; passing it
does not prove installed-wallet or public user acceptance. No public runtime was
changed. Release owner must integrate ordinary hunks into the current coherent
release graph, not replace formal inherited pins/Host from this checkout.
