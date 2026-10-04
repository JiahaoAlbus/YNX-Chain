# Card operation context and durable recovery checkpoint

Owned scope: apps/card only. Base: 210a06aa1d8d687e6cb0545ce5e19950393146c3. No formal build, deployment, SDK execution, service startup, account request, signature, transaction or user-store operation in this checkpoint.

## Actual source closure

The operation renderer now loads its journal under the current owner/session/expiry/card/client binding before enabling operations. Binding changes reset transient modal/busy/retry/error state; persisted pending records are not removed or automatically resent. Expired identities do not render stale statement events. A pending request belonging to another card remains preserved and readable as a reference, but readback/retry require reopening the original card.

Every journal write requires exact storage readback before dispatch. An unconfirmed write blocks new operations and retains the newly generated pending reference in memory without dispatching the mutation. History capacity also disables new actions. Result lookup and explicit retry remain original operation/resource/key/digest bound; UNKNOWN is never promoted to success. Notice indices render in the current selected locale, including after a failed operation. Local-save and other-card guidance supports all 12 existing locales.

## Restricted regression actually executed

- Original renderer regression: 10/10 passed, operations-scope-regression-20261004.log.
- Expanded renderer regression: 16/16 passed, operations-scope-six-regression-20261004.log.
- Frontend and server compiler-only typecheck: passed, operations-scope-typecheck-20261004.log.
- The renderer evaluates owned UI with the CardBusinessClient module stubbed. No actual Wallet SDK or private authority is invoked.
- The initial shell append used a wrong relative path; it did not modify the test file. Corrected append and expanded run are retained separately. No failing test evidence was overwritten.
- Prior 501-test checkpoint remains historical evidence for 210a, not a full-suite result for this new checkpoint. Full suite and formal build NOT_RUN here under the restricted regression instruction.

## Runtime consumption order and remaining authority input

Actual server startup must establish its pinned private adapter/source authority before state-key decoding and Store creation. The owned runtime client must validate an admitted backend/frontend source pair and original-key recovery feature before constructing a recovery-capable business client. Existing account:read readback and private operation scopes remain unchanged. UI must load the current-owner journal, verify the original digest, query the original result, and only on explicit UNKNOWN retry the same input/key. Confirmed history writes precede refresh of the current authoritative statement; historical results are not balances.

A's protected-startup capsule received and read on 2026-10-04:
card-original-protected-startup-source-20261004/HANDOFF.md and ORIGINAL_SOURCE_DELTA.patch, manifest a0c93523f77eb664f3a4e27c744e5fdfe798e171e44c41a6a715635b88d1a224, root d4b2a4e3fd2d967c268abcf361e86ffd4aac848fde8e31bd589ea951dd09b8ca.
It is a separate candidate input, not adopted or executed in this checkpoint. Its production current is null and fails closed; it does not supply authentication or a grant. Next source integration must retain existing encrypted Store, pending records and keys and exercise only disposable fixture regressions. Unique external input remains A's genuine protected current/role authority plus admitted matching backend/frontend source and authorized Host cutover. Do not relabel old 7f9/e95 or earlier 2e535 QA assets as this release.

Public deployment remains unchanged. Public full TEST lifecycle, protected authority, new release, stable Wallet approval/reject/restore/disconnect, funding credit and Product Session migration are not proven. Real issuance/PAN/CVV/fiat/real merchant payment remain false. This checkpoint is not product completion.
