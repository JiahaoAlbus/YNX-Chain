# Finance AI full caller/button/poll composition regression

Runtime source under test: `67c7ce2a75b2cb435acfb95f4c2da7a30fc477f0`, tree `00cdd73297ab0e714d2b5242f12b070d5a867792`; current unchanged app inherited at evidence predecessor `e3ba7a76e560d78a15b9abc650762c1bd9cf85f7`, tree `1defb95cdf25f66a42e810197d2c8ea3be2b52c4`. This successor changes only owned browser tests and evidence, not runtime code or shared protocols.

## Direct local composition exercised

The existing `ai-order-intent-browser.test.mjs` serves the actual Finance HTML/app and operates actual DOM buttons/listeners in local Chrome. Added controlled HTTP response barriers cover the whole interaction, beyond independently extracted functions:

1. Click create job A; click its real cancel button; hold the cancel response; click create B; release A's cancel; independently observe a subsequent GET for B. B remains running, its timer exists, no obsolete notice appears, exactly two creates and one cancel occurred, and no page error appears.
2. Same sequence with A initially ready and the real delete button plus confirmation dialog. Its delayed DELETE cannot clear B or stop B's next polling request.
3. Hold A's create response; dispatch the real private-state connected event used by the app to retire/reload its private workspace; click the now-released create button for B; return B first, then release A; observe B's next poll. B persists, its button remains restored in English, no obsolete notice/page error appears, and exactly two creates occurred.

Fixture IDs, provider/model labels and account/proof stubs are explicitly controlled local test data. No real Wallet provider account approval, signature, asset action, product login, public runtime, or AI provider execution is claimed. Private-state event coverage does not manufacture genuine Product Session evidence. Draft copy remains advisory review only.

## Executed results

`node --test apps/finance/tests/ai-order-intent-browser.test.mjs`: **10/10 PASS**, 10.349 seconds, including seven inherited normal/negative/localization/draft-only cases and the three new real DOM composition regressions. This is current app execution, not a new VM model.

`node --check apps/finance/tests/ai-order-intent-browser.test.mjs` and `git diff --check`: PASS. No unchanged full source suites were repeated just for a receipt. Prior 62 local engineering cases and their exact source scope remain separately preserved.

## Remaining gates unchanged

Fresh resource check at this continuation start: 210,400 KiB available / 100% Data capacity, below the prior 524,288 KiB minimum for a single bounded stripped-debug race link. No Go compile/link, Native package, archive rebuild, deletion, SSH, upload, Host retry, public mutation or real account/sign/transaction occurred. Empty-delimiter Go regression and full Finance Go validation remain pending resources. Source-bound public/installed product and shared genuine authorization/operation publishing remain incomplete. Only A may publish through the accepted shared composition; UNKNOWN channels remain protected.

Report this owned whole-caller evidence only to `接续测试网生态审计工作`. It is not an aggregate financial completion or a replacement for other products' public and transaction evidence.
