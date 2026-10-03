# Paper unreadable pending-intent recovery

Owner predecessor: `4a7d482787333f45002afcbb96471a2b0793e615`.

Previously `readPendingPaperIntent` silently removed malformed persisted input
and returned no pending intent. A new submission could then use a different
idempotency key despite an unknown outcome for the earlier request.

The owned UI now retains unreadable input unchanged and blocks new Paper writes.
The envelope is bounded, exactly four keys, exact UUID-shaped key, positive safe
integer amount, valid side/hash and canonical product serialization. Duplicate
keys/rewritten envelopes cannot silently be treated as exact replays.

The visible warning and explicit local-forget action cover all twelve locales.
Confirmation explains that forgetting does not cancel/delete a service order;
a later submission is separate and may duplicate the earlier intent. Cancel
preserves the saved bytes. Successful removal requires local storage readback;
failure retains unknown status and disables workspace writes. Valid unknown
requests retain the existing same-key replay behavior, including under a kill
switch; no service/session/engine permission is widened.

## Verification

- `node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/ui.test.mjs`
  PASS 85/85, 542.898583ms. Includes malformed/null/array/extra/string amount,
  invalid key, oversized and duplicate-key saved input; no new POST, explicit
  cancel/forget, twelve language updates, removal failure and existing exact replay.
- Real Chrome focused cohort: `node --test --test-name-pattern='actual Chrome retains unreadable Paper|paper requires a saved strategy|confirmed actual-service kill' apps/quant-lab/tests/browser.test.mjs`
  PASS 3/3, 5821.938792ms. Reload preserves unreadable intent; twelve confirm
  cancellations preserve bytes; explicit local forgetting permits later review
  without POST. Controlled snapshot cash remains 777, browser tabs remain one,
  page errors zero. Existing real isolated-service reconciliation/kill persistence
  and network-loss behavior remain passing.
- `node --check apps/quant-lab/web/app.js` and `git diff --check` PASS.

The previous storage test assumed an eager remove on startup even with no
pending record. That obsolete assumption was replaced with direct failed
explicit-removal coverage; get/set/silent-write storage failures remain tested.

## Truth boundary

Chrome uses the actual owned page on an isolated local Go server; the new recovery
case supplies a declared controlled snapshot, not fabricated public performance.
No real wallet/account/signature, capital order, Host, shared SDK, formal artifact
or production deployment was used. Source tests are not public or installed
acceptance. Full Financial goal remains incomplete; unique release owner must
integrate this ordinary UI change into the coherent release graph.
