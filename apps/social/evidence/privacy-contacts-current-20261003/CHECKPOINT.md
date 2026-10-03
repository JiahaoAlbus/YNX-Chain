# Social privacy/contact current-reader integration

Verdict: PROGRESS. Not Social acceptance, not a deployment lease.

Source: 199f66d0b1248302853ab500244f16220d648abf
Tree: 3f03352fbae13d51fb58e87d868256c3297c3346
Parent: 0afef4b88d8fc76810b882778ffe2143b606ea84
Branch: codex/social-wallet-chooser-20261001

## Actual defects reproduced before repair

The new original-store regression failed for settings, contact request,
withdraw, invitation creation and invitation revocation: the business effect
succeeded with current-reader calls=0 even though that reader returned an
authority-unavailable error. The execution transcript remains in this chat.

A mounted original HTTP profile regression also failed: the third current read
returned 503, but an independently persisted public locator remained after the
avatar operation was denied. The original Square profile effect had already
occurred; that effect was not falsely rolled back or called fully complete.

## Repair

- Wire existing original current-reader/try-lock entry into privacy settings,
  request creation, accept/reject/withdraw, contact removal, block, mute/unmute,
  invitation create/revoke and invitation readback.
- Keep the original local actor/account/device/key/session-binding/scope,
  cancellation and expiry guards after the outside-lock authority read.
- Preserve original idempotency, invitation tokens, request statuses, explicit
  recipient consent and independently owned follow semantics.
- Generate public locator candidates without an independent persistence side
  effect. Privacy settings and profile-avatar locator assignment now use their
  existing actor-bound original transaction and rollback snapshot.
- A failed avatar current read retains only the original prepared Social
  intent. The previously dispatched Square effect requires explicit original
  settlement; it is not silently repeated, deleted or reported complete.
- No new authority, grant, nonce database, identity, key or account is created.

## Actual tests/build

- Ten original-store operations reject authority 503 with unchanged Social
  state and one outside-lock read of exactly the existing business scope.
- Mounted original HTTP privacy route covers success, revoked 401,
  unavailable 503, cancelled 408 and busy 409. Success changes the actual
  original settings; failures leave the original state unchanged. One original
  Authorize, no proof replay or scope substitution.
- Public identity candidate has no independent state write.
- Mounted profile/avatar third-reader 503 leaves the prepared Social state
  byte-digest identical to its pre-dispatch snapshot, including no locator or
  settings side effect.
- Full final Go race: internal/social 14.466s; cmd/ynx-sociald 3.152s, PASS.
- Final ynx-sociald build: exit 0, readonly modules, network disabled.
- Git diff whitespace check: PASS.

The software authority tests exercise original local stores and mounted HTTP
handlers, not real Wallet grants, public deployments or installed acceptance.
Validation uses the existing isolated complete shared carrier
16195c6663525b0965725a922f46f38cf7b0a004, not an assumed live shared upgrade.
Original shared owner files, modules, SDKs and service configuration are intact.

## Remaining full-goal gates

Configured web business current authorization remains the exact 503 joint-
producer HOLD from 427faa63c. Sequential private and browser reads do not prove
simultaneous current authorization. Optional-reader legacy behavior is retained
for compatibility, NOT canonical-ready. Generic original ActionProof/nonce
atomic effect, real original Matrix HS/directory/observer mounting, formal
installed/public source-tree/version/provenance and full business lifecycle are
still incomplete or unverified.

Actual tool discovery in this turn exposed no MONSTER/dot execution tool.
MONSTER remains NOT_RUN; the unique coordinator has been asked for the real
ordinary-user validation channel. No substitute fake acceptance was generated.

No deployment, wallet account request, signing or transaction occurred. Old
accounts, devices, encryption keys, content and Matrix uncertain-intent ledger
are preserved. C01-C07/V01-V17 remain the full goal, not reduced to these tests.

Only coordinator: 01a094cc-0ba3-7901-bcd5-56fce8330c0d.
