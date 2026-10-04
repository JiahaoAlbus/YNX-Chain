# Desktop Pay normal entry / IPC / modal successor — 2026-10-03

Parent: `fb34d4e1cc9d403608006501247dad14a505f6f4`.
Owned changes: `apps/wallet-desktop/**` only. Native source, App.tsx, startup
assets, shared SDK/registry, versions, public packages, website and existing
profiles/QA processes are untouched. Prior frozen artifacts remain immutable.

## Actual source integration

The normal main process registers six Pay channels through `handleWalletIPC`,
therefore the existing exact installed main-frame guard applies to status,
reference review, actions, local restore, paged history and cancellation alike.
Preload exposes no compose/configure/policy/session/endpoint/key method.
The existing invoice-reference query and local QR decoder remain unchanged and
are explicitly NOT promoted from legacy projection to trusted payment.

The normal reference modal links to a separate Pay & original receipts dialog.
It mounts through the actual renderer and uses conventional review / separate
Approve / original-hash Check / one Settle / original receipt Read / verified
Done / paid history and older-page controls. Review another invoice exits the
archived receipt state without deleting it. Already-paid invoice review returns
the independently verified original archived receipt, not another approval ID.
Unknown settlement disables repeat submission until the original is restored
or its authenticated receipt is read. Scanning fills only a locally decoded
invoice reference; it does not fetch a quote, sign, broadcast or settle.

Main holds the independently verified quote; renderer sends only a reference,
single-use random review ID, action and original hash. The main service derives
the selected native account/public key from the EXISTING vault catalog and
composes the EXISTING lifecycle and private transaction journal. Its public
summary never includes raw transaction bytes, full session, payment-result
signature, private key or renderer-selectable authority. Context fencing reaches
the lifecycle before key access and immediately before outward effects; cancel,
close/edit, account/revision changes, lock and expiry reject stale operations.
Late originals/receipts remain retained as historical facts, not UI approval.

Real lifecycle end notifications do NOT invalidate unchanged context. This is
covered by driving the mounted dialog while the REAL existing lifecycle emits
its operation-end notifications. QR selection has a separate attempt revision
so same-account close/reopen cannot publish an older image result into a newer
dialog. History pages reject wrong-account, pending, duplicated, raw-payload or
fabricated-consensus-finality display rows; invalid rows never escape the failed
validation path as successful history.

## Protected external composition remains mandatory

`composeProtectedDesktopPay(integration)` is a main-process boot export, NOT
IPC/renderer/environment/CLI activation. Sole issuer A must deliberately call it
after the normal `walletAuthority` runtime is initialized. The service supplies
the actual existing runtime vault, lifecycle, journal and canonical native client;
the input cannot replace these with another profile or fake key store.

A supplies admitted independent `policy`; `quoteProvider.reviewInvoice(id,
{account,accountPublicKey,guard})` returning original signed `rawInvoice/rawIntent`;
canonical live `authorityForReview` / `authorityForOriginal` (full Pay session,
refresh, current/revocation/business-original binding); and authenticated
`settlementTransport.submitOriginal/readOriginal`. Settlement ports receive the
live guard and must check it at the actual request boundary / after internal
awaits. No legacy fixture token, public-response signer key, invented endpoint or
parsed Product Session grants real authority. Native local checkpoint remains
`consensusFinality:false` independently of the business settlement receipt.

DEFAULT ACTUAL SOURCE: no admitted external ports are supplied, therefore the
normal entry reports unavailable and never signs or fakes successful readiness.
This is a complete source wiring seam, NOT a claim that public Pay works.

## Verification

Exact mutable non-GUI candidate:
`/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`.
Inherited read-only SDK input: `9555b01e47519a5df882bb0092d2d20e1d7ce6e2`
at `/tmp/ynx-wallet-consumer955-20261003-Xw0YSp`.
Final full command `node --test --test-timeout=30000 test/*.test.mjs`:
**645/645, exit 0**, `desktop-pay-mounted-regression.log`.
22 new cases include the real existing vault/lifecycle/private journal/Pay flow,
normal service and mounted actual HTML controls, with explicitly synthetic OS
custody/merchant/current authority/chain/settlement transports. The prior native
chain adapter HTTP tests remain in the same full regression. No counters replace
the actual captured action transitions, key count or original POST count.
Syntax checks for service/UI/main/renderer and `git diff --check` pass.

NOT_VERIFIED: admitted real A inputs / canonical private Pay transaction and
settlement; actual Electron rendered usability / native image chooser / camera;
GUI cold restart, real OS/device authentication; protected Pay copy localization
in all 12 existing locales (new source copy currently English); full published
platform capability inheritance; A's successor shared SDK adoption; formal
forward versions and signing/packaging; official download/install/relaunch;
MONSTER. No existing running QA was reloaded, replaced or declared current.
Previous Android/iOS evidence is inherited, not rerun by this Desktop batch.
