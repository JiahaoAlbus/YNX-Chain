# Finance Broker snapshot display request ownership

Parent ordinary-source checkpoint: fe2ffc77199cc6460966a986777c12829e0cfa6b.
Only ordinary refreshBrokerSnapshot display ownership is changed in app.js;
shared auth, authority, SDK, callbacks and permissions are unchanged.

Existing API context checks rejected an old-account read, but the display catch
handler unconditionally changed brokerSnapshotState to unavailable. A delayed
old rejection could therefore overwrite a newer account's successful view.
Same-account out-of-order refreshes also lacked a display sequence fence.

Each snapshot refresh now captures its sequence and existing state.context.
Only the latest still-connected request in that same context may render either
data or unavailable. Signed-out refresh invalidates older ownership and renders
guest without a request. Current malformed replies still fail unavailable, not
empty or a claimed zero balance. No new authority or financial operation is
enabled; amounts, provider/environment and wire protocol are unchanged.

Executed actual production-function VM tests and actual local Chrome display
test: 5/5 PASS, 1373.161666ms total. Covers old success/rejection after switch,
out-of-order same-account success/error, signed-out pending read and malformed
current reply. Actual Chrome verifies current display survives old failure and
then stays guest after sign-out, with no additional signed-out HTTP request.
These tests use controlled API results and do not prove canonical auth.

Existing owned-save-controller tests combined with initial four source cases:
13/13 PASS. Existing owned-save-browser + broker-execution-browser served-source
regressions: 33/33 PASS, 37500.164041ms total, including twelve-language guest UI,
callback URL scrubbing, draft retention, account switching, unknown outcomes
and disabled execution boundaries. Controlled authorization fixtures are not
real Wallet/provider approval or provider execution evidence.
JS syntax and git diff --check PASS.

Source/local browser checkpoint only: public current-source binding, installed
flow, real account approval/private session and Broker execution remain unproven.
Integrate just this ordinary function hunk into the unique release owner's
coherent current Finance graph, not this entire inherited app/authority file.
No Host, public deployment, service/config/state, account/signature/transaction
action was performed. Ordinary source rollback is this isolated display hunk.
