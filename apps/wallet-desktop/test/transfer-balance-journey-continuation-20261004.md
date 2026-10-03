# Transfer, review and balance journey continuation — 2026-10-04

Parent: `89733671048de340b8c987271bcdf6fb2949be97`, which freezes the
shared Native scanner lifecycle successor of admitted `f412170d4e9`.
Write scope remains the two owned Wallet products. No installed package,
user account, password, key, journal, shared protocol or release version changed.

## Product repair

Prepare replies, thrown errors and button cleanup now belong to the exact
account/security view, control owner and Send draft. A fresh request cannot
have its busy button released by an older request's finally. Unchanged security
notifications preserve the busy owner; an edited draft releases that owner.
Opening Send explicitly starts a fresh input generation, without unlocking,
signing or sending. The existing password-on-demand entry remains unchanged.

Explicit submission keeps its original ID and main-process journal semantics.
Old success/failure/throw replies cannot overwrite a new draft/account or close
its review. Completion cannot show Send over another open password/backup
dialog. Pending approval owns its button through unchanged notifications.
Journal refresh remains in finally even if the UI owner is no longer current;
there is no deletion, re-signing or automatic retry of an uncertain transaction.

Balance rendering now validates the existing public projection's selected
account, bounded nonnegative decimal amount, boolean capability and ISO UTC
timestamp before publishing either amount. Missing/mismatched/invalid current
projections end loading with retryable unavailability, rather than remaining
"Checking" or rendering an invalid amount. Current failures do not erase local
accounts. Old account requests remain silent. Loading, unavailable, verified
legacy capability and timestamped success states now use all twelve display
locales; amounts remain original text. No RPC or IPC fields were added.

## Retained evidence

Log directory: `/tmp/ynx-wallet-desktop-ui-20261004-wjXlEW/`.
Actual pre-change renderer is retained at
`/tmp/ynx-wallet-transfer-original-20261004-s078x5/apps/wallet-desktop/src/renderer.js`,
extracted from the full `897336710` owned archive, not reconstructed fixture code.

- `transfer-view-owner-original.log`: original 1 PASS / 8 FAIL.
- `transfer-view-owner-original-expanded.log`: expanded 1 PASS / 10 FAIL,
  exit 1; SHA-256 `0048a53ddc55af6cd71ba969991b46fc11ba2d2d65b9dafc8801ce28f05716b6`.
- `balance-projection-original.log`: 11 PASS / 10 FAIL, exit 1;
  SHA-256 `544de47954a235d0786fc438152c0f2028f676ac94ebdabbea5af22844da84ff`.
- `transfer-balance-journey-final-related-v2.log`: 148 PASS / 0 FAIL, exit 0;
  SHA-256 `0599cb4835484a98e0a3c39372f0688c07045f67d3245d8aa42a26a573dfba3d`.
  Actual renderer extraction, account receipt composition, password-on-demand
  shell, recipient input, balance states/locales, canonical sender,
  unknown transaction resolution and local snapshot history are included.
- `transfer-journey-authority-receive-related.log`: 75 PASS / 0 FAIL, exit 0;
  SHA-256 `36678e462cc99d5798140bb701b21a40906ff7acd5cbc9145660e901a4972b27`.
  Existing native service, account/key authority, published authority,
  recovery locale, independently decoded Receive pixels and ordered clipboard
  copy contracts were checked. These tests do not prove actual OS clipboard use.
- `node --check` for changed renderer and `git diff --check`: exit 0.

The intermediate `transfer-view-owner-related.log` records 97 PASS / 2 FAIL:
the fixture's replacement security object omitted its real boolean
`authenticating`, assigning undefined to a plain fake disabled property.
The fixture was corrected to the real security-state shape; the assertions
were retained, not relaxed. Intermediate logs and original failures remain.

Frozen Native `App.tsx` SHA-256 remains
`c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`.

## Exact continuation / separate gates

This is SOURCE candidate evidence, not independent admission or full product
completion. Physical camera/biometric flows, Mac GUI, installed code34 upgrade,
real transfer/Pay and MONSTER are NOT_RUN in this batch. No QA profile substitutes
for the original formal package, and no account/secret inputs are requested.

Next owned work should audit the complete account recovery + unknown journal
journey against real delayed security notifications and file-dialog returns,
preserving old Wallet files and the original signed transaction. Native flow
wiring changes in frozen `App.tsx` require A's explicit successor handoff;
do not duplicate the root or claim Web parity from the Native QA shell.

Integration owner A still supplies the real protected Pay OS/runtime factory,
current nonce/effect authority and official package composition. Crypto consumer
registration/enforcement/recovery needs A's approved account-policy readback,
canonical review bytes, independent funding PQ key custody and durable result
contract. No ad-hoc wire shape, Social-key reuse, fabricated mnemonic, silent
PQ generation, or activation is introduced while those contracts are absent.
