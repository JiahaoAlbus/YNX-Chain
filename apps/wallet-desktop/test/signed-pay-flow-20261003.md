# Desktop signed Pay flow successor — 2026-10-03

Inherited parent: `bb858e4f20b7b7bc5fc753647cddd183ff0014a2`.
Owned source only: `apps/wallet-desktop/**`. Native `apps/wallet/**` remains
the prior published-loader / receipt-recovery batch. No shared SDK, registry,
startup branding, release version, website, certificate, installer or real
account/profile changes. No running QA source replacement or GUI interaction.

## Delivered source composition

`createProtectedDesktopPayFlow` requires explicit main-process composition of
the existing vault, lifecycle, private transaction journal, exact native chain
client, independently admitted signer policy, live full Pay authority and
authenticated original settlement transport. It has no production fixture,
public-response authority, renderer enable flag, default bearer or guessed URL.
The default `main.mjs` / renderer are NOT switched to these ports by this batch.

Operations: explicit reviewed `approve`; historical-only `restore`; original
hash `checkOriginal`; one captured-result `settleOriginal`; fresh full same-account
`readOriginalReceipt`; verified `done`; protected historical `history`.
Approval signs inside the existing encrypted vault/lifecycle once, retains and
reads back the original, revalidates canonical authority/business, durably
claims the attempt, then invokes one original native POST. ACK remains unmined.
Any retained original blocks another approval, including an interrupted journal
write, expired quote, lost ACK or cold restart. Restore never signs or POSTs.

The authenticated settlement transport receives the live effect guard and must
call it immediately before its actual network request and after internal awaits;
it must authenticate canonical actor/device/origin, scope, revocation and original
business membership. A label such as `authoritative-central-pay-api` is NOT an
authentication mechanism. Late authenticated receipts may be retained as facts
while the revoked foreground operation still fails. No silent resubmission.

Schema 4 is additive: existing Ethereum originals/rejections/resolutions stay in
the same private file. Schemas 1/2/3 read without rewriting; old signed packets
conservatively inherit broadcast-attempted=true, not invented resend permission.
Each active packet has exactly one matching progress entry. Native checkpoint,
settlement, original invoice/result and immutable paid history bindings are
validated on read; corrupt history blocks creation without deleting anything.
Done atomically archives the full original/proof/settlement, establishes the paid
invoice marker, and releases the active entry in one private-file replacement.
Exact known-hash Done is idempotent after restart. Verified facts never demote;
local checkpoint evidence always retains `consensusFinality:false`.

## Evidence and outstanding gates

Isolated mutable test candidate (not a running GUI):
`/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`.
Read-only SDK input: commit `9555b01e47519a5df882bb0092d2d20e1d7ce6e2`
at `/tmp/ynx-wallet-consumer955-20261003-Xw0YSp`.
Full command: `node --test test/*.test.mjs`, log
`desktop-pay-flow-regression.log`. Final full run: 623/623, exit 0.
All new end-to-end cases use real existing Desktop vault/lifecycle/private-file
classes and native adapter, with clearly synthetic key custody/merchant/session,
controlled HTTP and settlement authority. They are SOURCE regression evidence,
not a real OS authentication, registered Pay transaction or public settlement.
`node --check` and `git diff --check` pass.

NOT_VERIFIED: A's actual independently admitted policy and full live Pay ports;
their real settlement/revocation/business reservation behavior; A's successor
shared-SDK composition; normal IPC/renderer Pay flow; complete published-platform
functional inheritance; GUI/device approval and cold restart; same-package and
same-certificate Android forward version above publicly published code 34;
formal macOS/Windows/Web packaging; official website download/install/relaunch;
MONSTER. Prior Native results are inherited evidence, NOT rerun by this batch.
Do not publish owned stale Android version/code as an upgraded public release.
