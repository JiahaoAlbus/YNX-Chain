# Controlled actual Social feed caller verification

Date: 2026-10-04. Coordinator: existing chat
`01a094cc-0ba3-7901-bcd5-56fce8330c0d` (no new coordinator).
Only worktree: `/Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001`.
Baseline HEAD: `a9ec39c319020b2edd7bf10000df6b9718592c5c`.

## Result

- New feed caller suite: 16 tests, 15 passed, 1 failed, exit 1.
- Bounded regression: 27 tests, 26 passed, 1 failed, exit 1.
- Existing message caller: 5/5 passed. Existing filter UI: 6/6 passed.
- No skips, todos, assertion weakening or product repairs.
- Five consumed product files match their pre-test SHA256 fingerprints.
- Existing dirty work was preserved; writes were confined to the requested
  new test and this evidence directory. No commit, push or deployment.

## Original failing product caller

`apps/social/web/matrix/restricted-feed-ui.mjs`,
`mountRestrictedFeed -> addComment -> form submit listener`.
The listener captures `const generation=epoch,binding=capture()` at submit
time instead of retaining the generation in which its article was rendered.

Reproducer in the new test at line 128:
`delete/reload rejects retained comment submit from the removed generation`.

1. Actually mount and reload the product feed; retain its original form node.
2. The controlled index service removes the moment; call actual reload.
3. Confirm the rendered article has disappeared.
4. Submit an event on the retained form. The controlled authority still allows
   reading the original encrypted parent; removal from this view does not
   revoke that independent permission.
5. Expect no parent read, draft save or publication from this retired caller.

Expected: `{reads:0,saves:0,publishes:0}`.
Observed in both test runs: `{reads:1,saves:1,publishes:1}`.
The exact removed parent/index reaches the controlled publication port.
The original assertion remains red. The log includes the assertion and stack
at `local-filter-feed-caller.test.mjs:134`.

This proves a stale retained caller can cross a view generation boundary.
It does not establish that a user can normally click a removed DOM form, or
that a real Matrix service would accept publication to a deleted event.
The sibling retained attachment caller rejects the old generation correctly.
Lock/destroy reject retained comment and attachment actions in this harness.

## Actual scope

The test directly imports the unchanged `mountRestrictedFeed` and
`mountLocalContentFilter`. The latter imports the unchanged TypeScript
`LocalContentDisplay`; no display decision, display gate, canDisplay method,
module import or product source is replaced. Existing local `tsx` only
transpiles TypeScript for execution.

Controlled ports: minimal DOM/event elements, index service, guarded decrypted
consumer results, authority binding, draft storage, comment sender/publication,
attachment download and object URL hooks. Classifier callbacks supplying safe
scores or deferred completion are deterministic lifecycle test inputs, not
model admission. The unavailable-model cases supply no classifier.

Coverage:

- Enabled and unavailable: moment body, indexed comment and attachment deny.
- Off: fresh original index read and authority checks; revoked authority cannot
  restore body, publish a comment or download an attachment.
- Late body decryption after enabling remains hidden through the real gate.
- Late attachment after enabling or lock cannot release a URL; returned bytes
  are wiped. Off positive control downloads, revokes URL and wipes bytes.
- Messages-scope cancellation leaves actual feed moments intact, off and with
  enabled controlled classifier completion. Existing message caller tests also
  run separately in the regression.
- Lock/destroy reject late decryption and retained actions.
- Delete/reload rejects stale attachment and classifier completion; stale
  comment submit fails as documented above.
- Late classifier completion after lock cannot display the original.
- UNKNOWN retains original nonce, text and indexed parent across enabled/off,
  reload, remount, replacement attempts and failed exact readback recovery.
  Exact indexed confirmation clears only that original nonce with no resend.

Not verified: real DOM/browser, Matrix node/SDK, persistent encrypted vault,
installation, account, Wallet signing, transaction, model installation or
admission, Native consumption, dot, public brand or production deployment.
No network/account/sign/transaction operation was performed by this suite.

## Reproduction and preserved logs

Run from this worktree's `apps/social` directory, where `tsx` is installed:

```sh
node --import tsx --test web/matrix/local-filter-feed-caller.test.mjs
node --import tsx --test web/matrix/local-filter-feed-caller.test.mjs web/matrix/local-filter-ui.test.mjs web/matrix/local-filter-caller.test.mjs
```

Successful execution with a red product assertion:

- `feed-caller-social-tsx.log` and `.exit`: first executed 16-case suite.
- `scoped-regression.log` and `.exit`: 27-case bounded regression.

Preserved runtime startup failures, not counted as product test results:

- `feed-caller-first.log` and `.exit`: Node 26 rejects removed
  `--experimental-transform-types` option.
- `feed-caller-native.log` and `.exit`: native strip-only loader rejects the
  unchanged TypeScript constructor parameter property.
- `feed-caller-tsx.log` and `.exit`: worktree-root resolution cannot find
  `tsx`; using the existing app-local package resolves this without installs.

Baseline/preservation evidence:

- `baseline-head.txt`.
- `baseline-scoped-dirty.txt`: target scope snapshot during initial evidence
  creation; its own newly created output file can appear in this snapshot.
  Before evidence creation, the scoped target status was empty.
- `product-source-before.sha256`.
- `product-source-preservation.log` and `.exit`: all five product hashes OK,
  exit 0.
- `final-scoped-dirty.txt`: scoped untracked snapshot after test execution,
  before creation of this report.

New delivery paths are solely
`apps/social/web/matrix/local-filter-feed-caller.test.mjs` and
`apps/social/evidence/local-filter-feed-caller-20261004/**`.
The main owner's Native work and public branding scope were not duplicated.
