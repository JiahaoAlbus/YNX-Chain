# Paper record timestamp boundary

The shipped renderer previously accepted any finite Date.parse result as a verified Paper timestamp. The new direct regression failed before the fix: `0` displayed with no unverified warning. Impossible normalized calendar dates, date-only values, missing timezone and year zero were also not an adequate RFC3339 receipt boundary.

The ordinary renderer now reuses the existing strict auditTimeValid calendar/RFC3339 validator. Invalid records stay visible and marked unavailable/unverified, never silently converted to a valid fill. Valid leap-day nanosecond and explicit-offset source strings are preserved exactly. No service record, quantity, order, tenant or authority is changed.

Executed: full `node --test apps/quant-lab/tests/business-flow.test.mjs` 66/66 PASS, 657.64925ms. The focused new regression was 0/1 before repair. Tests execute the shipped app in the declared DOM/HTTP fixture; this is not public runtime, real wallet approval or executed trading evidence.

Integration: ordinary one-line verifiedPaperRecord timestamp fence plus direct regression. Prior v2 integration manifest remains an immutable earlier source checkpoint and deliberately does not claim these new bytes. Release owner must incorporate this successor hunk and bind its rebuilt runtime independently. Rollback only this hunk, preserving records and shared authority. Public/install/product-complete gates remain false.
