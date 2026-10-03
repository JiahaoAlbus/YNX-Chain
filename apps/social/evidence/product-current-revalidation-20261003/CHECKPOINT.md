# Social original actor revalidation checkpoint

Status: PROGRESS, not product acceptance, not a deployment lease.

Source: 427faa63c9e0700ad6ef25c77bed2c88c332f930
Tree: 277af335e77febb1ae4a15bf2402a83ca248445b
Parent: 7b7bc3c749da169057526a381f2b8fdff0af919b
Owner branch: codex/social-wallet-chooser-20261001

## Owned change

- A configured original Product Session revalidator receives a deep clone of
  the full original session and exactly the existing business scope. No new
  enrollment, repeated Authorize, proof rewriting, or expanded grant.
- Profile/follow prepare, dispatch and completion read outside the original
  Social mutex. A busy mutex after that read returns conflict rather than
  waiting and dispatching a stale decision. The prepared original intent is
  retained; an explicit subsequent request requires a new current read.
- Original expiry, actor, account, device keys, binding and context guards
  remain in force. Private request hooks are neither persisted nor serialized.
- Typed authority 503 remains 503; cancellation remains 408, not revocation.
- Configured web revalidation fails with
  SOCIAL_JOINT_CURRENT_AUTHORITY_REQUIRED (503). Separate private-session and
  browser-family reads do not provide one authoritative current decision.
- An unset optional reader preserves the existing legacy path. That path is
  explicitly NOT evidence of canonical current authorization readiness.

## Actual engineering checks

The isolated existing stage /tmp/social-backend-16195.enQ7Rc uses the verified
complete 16195c6663525b0965725a922f46f38cf7b0a004 shared carrier, not an assumed
upgrade of the current live shared source. No shared owner files were changed.

- Mounted original HTTP profile route: success, authority unavailable,
  revocation, replaced device, replaced scope, expiry after read, cancellation
  after read, and busy lock after read. Original full session input and scope
  were checked at every read, including mutation isolation. No proof replay.
- Busy dispatch preserved its prepared intent and original Square bytes;
  explicit same-intent retry after authority revocation rejected the request.
- Web split-reader negative: 503 without calling the private reader.
- Full Go race run: internal/social 13.486s; cmd/ynx-sociald 3.203s, PASS.
- ynx-sociald build with readonly modules and network disabled: exit 0.
- Git diff whitespace check passed.

The mounted tests use software fixture authority and local original stores.
They do NOT establish real Wallet, public, installed, or MONSTER acceptance.

## Actual interface observation

Opened the existing complete frontend at http://127.0.0.1:8874/ in one tab.
Settings -> Chat appearance -> Cancel returned to the locked guest workspace.
No account grant, wallet sign-in, sign, transaction or preferences save was
triggered. Observed warning/error console entries: zero.

This frontend is the earlier e0b3ec8232c4dbaec12d5dc59bc763427adb97e0 build.
It is NOT a source-bound runtime of the new backend commit. guest-appearance.png,
guest-settings-recovered.txt and guest-console.json retain that limited proof.

## Remaining integration and release gates

Central/A must provide the original authoritative joint current producer for
the unchanged full Product Session plus original sealed browser grant/family/
generation, and integrate generic original ActionProof/nonce atomically with
the business effect. This batch is not that complete authority contract.
Do not move remote awaits under store locks or create another identity/nonce
database to substitute for the original authority and Matrix ledger.

Real historical Matrix directory/HS/observer mounting, public source-bound
service identity and real original accounts/devices are still unverified.
Installed/public formal baseline and artifact provenance must be established
without replacing the real product with a QA/helper or regressing old data.
MONSTER was not invoked and remains NOT_RUN. Full C01-C07/V01-V17 and ABC
business acceptance remain incomplete. No deployment occurred.

Only coordination destination: 接续测试网生态审计工作
01a094cc-0ba3-7901-bcd5-56fce8330c0d.
