# Account backup/recovery + unknown journal continuation — 2026-10-04

Parent: `344701b4e7366cdd47cc92309122668b3eec3cd4`.
Owned source changes are only `password-vault-ui.mjs` and the new local
`recovery-file-input.mjs`. Native product source, main process, key lifecycle,
password crypto/vault/files, permissions and transaction journals are unchanged.

## Complete owned journey addressed

The native file chooser returns to its original DOM input. The previous
recovery form reused that input after cancellation, same-account reopening,
account switching or changing recovery source: an old return could replace a
fresh selection. This is a local input ownership defect, not evidence that the
main vault accepted a different account's key.

Recovery now retains a selected File only for the original input node, account,
source, password mode, security revision and UI generation. Clear/cancel replaces
the input without deleting any disk backup. The read itself is bounded to
100,001 bytes and exact selected file size is checked before fatal UTF-8 decode
and custody IPC. Existing Unicode/BOM JSON compatibility is retained.

Changing account/source/password mode/historic Wallet retires pending reads and
previews. Old errors/finally cannot clear newer drafts. Current review projection
must match the selected account and password mode, retained account list,
bounded nonempty preview ID and unexpired producer timestamp before confirmation.
No RPC/IPC field, new custody protocol or signing authority was introduced.

## Evidence retained, not replaced by greens

QA log directory: `/tmp/ynx-wallet-desktop-ui-20261004-wjXlEW/`.
Original UI source is the actual inherited file extracted from the full
`897336710` archive at
`/tmp/ynx-wallet-transfer-original-20261004-s078x5/apps/wallet-desktop/src/password-vault-ui.mjs`;
that source is unchanged in parent `344701b4e`.

- `recovery-file-journey-original.log`: 2 PASS / 5 FAIL, exit 1;
  SHA-256 `cf8f89f5bead97a316834446a889c1fd03127477ef817feaa50648babaaeeba1`.
- `recovery-file-review-original-expanded-v2.log`: 3 PASS / 17 FAIL, exit 1;
  SHA-256 `2bfce7e27ff8cf88e24eb9e027f9093171ed12430218a42ffbd526832446d7c3`.
- `recovery-unknown-journey-final-related-v5.log`: 126 PASS / 0 FAIL, exit 0;
  SHA-256 `34ff5183fccefb9ea66b696feeb0974cdaaae41947243070ffefcfbd8e3e34d8`.
  Includes actual recovery UI, password-on-demand shell, actual main backup
  handler extraction with real ALS lease/private file writes, real password
  AEAD vault, legacy migration, key lifecycle, local recovery review locales,
  and unknown transaction resolution UI.
- `native-recovery-outbox-final-related.log`: 136 PASS / 0 FAIL, exit 0;
  SHA-256 `e6a9addba20114d781d3cc9993f0623e5c69fd27973cf2dfd124551334961fb6`.
  New composition runs actual Native repository recovery plus outbox on the
  same simulated secure adapter: success/cancellation retain other accounts
  and exact original unknown bytes; cold send remains blocked before prepare
  or POST. Related repository, operation lifecycle, recovery review and outbox
  regressions are included. This is not hardware SecureStore/biometric proof.
- Native `tsc --noEmit`, changed Desktop module syntax checks, and checkout
  `git diff --check`: exit 0.

Real Desktop cold composition uses known public scalar fixtures, real vault
AEAD and host private files: keep/reset-password recovery preserves two accounts,
revokes old permissions, and cold restart reopens only the recovered identity
while retaining byte-identical original signed unknown journal. Public receipt
reads use literal existing Core capability and simulated not-found responses;
there is no network, new signing, nonce lookup or automatic POST.

Actual main backup handler tests confirm the original ALS lease survives only
its owned transient dialog blur. Screen lock, account change or TTL prevent the
write; a pending old operation blocks a new unlock instead of borrowing it.
The ciphertext/authentication/dialog are explicitly fixtures, not OS key proof.

Intermediate failures remain: the first cold composition used a wrong method
name (`assertReady`, corrected to real `assertResolved`); earlier DOM fixtures
lacked native select-value and descendant textContent semantics. Fixtures were
made faithful; assertions were not relaxed. No original failures or user files
were removed. The earlier 148/75 suite was not mechanically rerun.

## Still separate / precise next step

Native frozen `App.tsx` SHA-256 remains
`c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`.
Normal CUA selection of the owned Electron app again reported Mac locked and
automatic unlock unavailable. No bypass/input/profile erasure was attempted.
GUI, physical file chooser/camera, enrolled biometrics, installed code34
upgrade, real Pay/transfer, MONSTER and user acceptance remain NOT_RUN here.

This freeze is a source candidate, not independent admission or product
completion. Next ordinary owned journey is connected-app/session revocation
and re-entry after account recovery, including retained unknown transaction
readback before a new approval; use existing contracts and exact account intent.
Any frozen Native root wiring needs A's explicit successor handoff.

A supplies the real protected Pay factory/nonce-effect authority, approved
crypto account policy/independent funding PQ key custody/canonical dual-review
result contracts and official package composition. Missing producers remain
accurately unavailable, not replaced with invented ports, Social key reuse,
fabricated old mnemonics, implicit PQ registration or activation.
