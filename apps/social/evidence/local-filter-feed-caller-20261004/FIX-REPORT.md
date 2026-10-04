# Authorized comment form lifecycle repair

This follow-up supersedes the unresolved result in REPORT.md. Original red
logs and their exit files remain unchanged.

Only product change: restricted-feed-ui.mjs, addComment form lifecycle.
A single repair patch captures generation and authority binding at form
creation, rejects a retired generation before setting busy, and retains the
existing gate before parent read and after each asynchronous boundary.
The original authority binding is freshly validated by assertCurrent; the
form cannot capture a replacement account binding at submission.
No nonce, parent validation, pending intent, draft reservation, UNKNOWN
recovery or confirmation behavior was replaced.

The existing positive off recovery test now additionally submits its retained
pre-reload form, checks zero additional read/save/publish, then successfully
submits the new form. It changes authority without changing the epoch and
verifies the remaining form cannot read/save/publish under that new binding.
All original test cases remain, including the original deleted-form assertion.

Executed from the unique worktree's apps/social directory:

```sh
node --import tsx --test web/matrix/local-filter-feed-caller.test.mjs web/matrix/local-filter-ui.test.mjs web/matrix/local-filter-caller.test.mjs
```

Result: 27 tests, 27 passed, 0 failed/cancelled/skipped/todo, exit 0.
New feed suite 16/16; existing message caller 5/5; filter UI 6/6.

New follow-up evidence:

- scoped-regression-fixed.log and scoped-regression-fixed.exit: full green run.
- comment-form-lifecycle-fix.patch: exact product diff.
- unowned-source-preservation-fixed.log and .exit: the four consumed product
  sources outside the expanded write set still match the original baseline,
  exit 0. restricted-feed-ui.mjs is intentionally excluded after its repair.
- FIX-REPORT.md: this follow-up report.

All work stayed in /Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001.
Writes stayed in the expanded product boundary, original new caller test and
original evidence directory. No other product source, shared files, commit,
push, deployment, account, sign or transaction action.
Qualification remains controlled DOM/authority ports and actual product
feed/filter/LocalContentDisplay execution; no real Matrix, SDK, install,
Native, model admission or dot acceptance claim.
