# Late review result / visible selection race repair

Baseline: b31319690c99731a93619f9f6fd973a8908b406f.
Original independent failure: 2cc1ec6ee45e354e394254420bd9a5ae6f1badce,
four FAIL and one lock PASS in Central's actual Chromium DOM probe.

The composer now reserves a review intent and edit epoch synchronously. Draft,
file and exact selected group/friend IDs must still match after the final read
authorization await, before assigning reviewed state. Lock and editing
invalidate the epoch. Publish compares the reviewed selection/epoch again,
including after identity and file-read awaits. Inputs and selectors stay busy
through review and publish, even when workspace controls invoke refresh.

Local validation: 108 npm tests passed, zero skips; typecheck passed. The UI
module bundled with esbuild. Actual headless Chromium, viewport 390x844, ran
the original five independent scenarios (choice, draft, group, selected, lock).
All five denied late Publish and sent zero messages. Original busy controls
were disabled during read in every case; document width was 390.

The durable probe `src/independent-ui-review-epoch.mjs` is derived from the
independent fixture with two explicitly disclosed harness-only changes:
the module loader serves the actual bundled UI to include its new official
attachment-codec dependency, and, after recording disabled busy controls, the
probe forcibly re-enables DOM inputs to exercise hostile changes as well.
Original expected-denial and zero-send assertions are unchanged. This is not
a claim that ordinary user input can edit disabled controls. Authority and
Matrix client remain synthetic, so this is local browser UI regression proof,
not real homeserver/public/installed acceptance.

To reproduce from apps/social, bundle web/matrix/restricted-moments-ui.mjs with
esbuild --bundle --format=esm --platform=browser to
/tmp/ynx-social-review-epoch-ui-20261002.mjs, then run
TMPDIR=/tmp node src/independent-ui-review-epoch.mjs.

Logs and original independent failure are preserved in
`moments-review-epoch/20261002/`. No deployment, real account authorization,
signing/transaction, shared source or actual stored data changes occurred.
Full ProductSession liveness, true HS, durable cold recovery, all ordinary-user
and platform/full Social v2 gates remain independent and unproved.
