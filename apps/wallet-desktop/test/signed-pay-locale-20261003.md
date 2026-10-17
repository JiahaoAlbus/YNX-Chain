# Desktop Pay 12-locale / immutable display successor — 2026-10-03

Parent: `35be8e292962f2654d3376ad55b0532aa5e9b78a`.
Owned changes only: `apps/wallet-desktop/**`. No Native/App.tsx, startup assets,
shared SDK/registry, release version, website, package, profile or running QA
changes. Prior complete source freezes are preserved.

## Delivered actual product source

The normal Pay modal now enrolls its static controls, QR instructions, approval,
original-transfer recovery, settlement, receipt, paid-history, next-invoice and
unknown-outcome/finality disclaimers in the existing Wallet locale controller.
58 Pay-owned keys have explicit translations in all 12 existing locales: en,
zh-Hans, zh-Hant, ja, ko, es, fr, de, pt, ru, ar, id. No English fallback is used
for a missing Pay key in these dictionaries. Existing non-Pay copy is inherited.

Dynamic notices and owned proof-state descriptions use the same locale engine.
Wire enums remain unchanged; their display labels are localized independently.
Raw merchant names, account/recipient, invoice IDs, amount/fee/total values,
original hash, quote time and digest are NOT localized or rewritten. Raw facts
use isolated direction (merchant auto; account/address/hash/numbers LTR). History
uses the existing isolated text-parameter renderer, never HTML, with merchant
name auto and amount/fee/invoice/hash LTR. Switching language affects text only:
no cancel/re-review, authority refresh, signature, POST, settlement or record
mutation is added. Inputs and the existing original review ID remain unchanged.

Long translated action buttons wrap even when the OS window is wider than
620px but the modal itself is only 520px. This fixes the prior six-control row
that could overflow at desktop width. Logical spacing/borders, shrinkable fact
columns and single-column narrow layout retain the existing 44px targets and
user-relative text sizing. Original logos and aspect ratios are unchanged.

## Verification and limits

Exact isolated non-GUI mutable test candidate:
`/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`.
Read-only SDK input remains `9555b01e47519a5df882bb0092d2d20e1d7ce6e2`
at `/tmp/ynx-wallet-consumer955-20261003-Xw0YSp`.
Final command `node --test --test-timeout=30000 test/*.test.mjs`:
**649/649, exit 0**, log `desktop-pay-locale-regression.log`.
Targeted initial locale/normal-service run: 35/35, exit 0,
`desktop-pay-locale-targeted.log` (before the layout source assertion was added).
Syntax checks and `git diff --check` pass.

New tests enumerate every Pay key/parameter across all locales; verify actual
HTML controls are enrolled while raw inputs/facts are excluded; drive mounted
review, original-check, settlement, Done and history state transitions across
all 12 locales; assert exactly one review plus unchanged opaque approval ID and
original-hash action inputs; preserve malicious-looking merchant text without
creating image/script nodes; verify history text parameter order/direction and
byte-for-byte raw identities/digests; inspect the actual responsive CSS rules.
Prior full real existing vault/lifecycle/journal/normal-service regression stays
in the same suite. Locale DOM tests are explicit controlled summaries, NOT real
merchant/OS/private-session/transaction or browser pixel acceptance evidence.

NOT_VERIFIED: actual rendered Electron/device fit and accessibility across
locale/text-size/viewport combinations; native-speaker wording review; real
native image-chooser/camera and GUI cold restart; A's real independently admitted
policy and canonical full private Pay/business/revocation/settlement ports;
complete published-platform capability inheritance; successor shared SDK
adoption; formal same-certificate forward Android code above published 34 and
other platform versions; official website download/install/relaunch; MONSTER.
Default normal Pay still reports unavailable until A composes the real ports.
Localization cannot grant authority or prove a payment. Native prior results
are inherited, not rerun by this Desktop-only batch.
