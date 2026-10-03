# Card TESTNET operation successor intake

Status: OWNED_SOURCE_IN_PROGRESS; not public completion or a release approval.

Worktree: `/Users/huangjiahao/.codex/worktrees/f41f/YNX Chain`.
Branch: `codex/card-test-service-recovery-20261002`.
Starting committed checkpoint: `66126513738ecbd77a372d2ab7f5ac34076c2208`.
This is an in-progress source checkpoint, not a green release candidate. The
incorrect new test expectation awaits correction authorization; its failed log
is retained. The exact checkpoint and remote readback are reported separately
after commit/push, rather than inventing a self-referential source hash here.

## Product scope

This is a Testnet Card service, not a real issuer integration. Guest exploration
and the existing explicit wallet-bound application/approval/backend creation flow
remain intact. The operations panel is attached to an authenticated, validated
Card API statement, never a guest-generated account or historical local ACTIVE
record. Real fiat, PAN/CVV, card-network clearing and real merchant payments remain
unsupported and false.

The panel provides separate user confirmation for freeze/unfreeze, expired-hold
recovery, spending limits, YNXT funding intent, Core transaction verification,
simulated merchant authorization, capture, reversal and refund. Funding intent is
not credit. The UI never requests a wallet transfer or fabricates a transaction
hash. A user-supplied Testnet transaction still requires the existing authoritative
Core verification before backend credit. Wallet transfer UX and direct installed
approval/real-chain evidence are not completed by these source tests.

## Durable unknown-operation contract

Before POST, persist owner/card/kind/resource/original body/idempotency key/body
SHA-256. SHA-256 input is the existing Card backend canonical JSON format, not a
new Wallet signing protocol. An API timeout leaves the exact original pending
request intact. Mount, reload and account switch never resend mutations.

New read-only endpoint:

`GET /api/card/v1/operations/:operation/:resourceId/:idempotencyKey/:digest`

Existing required scope: `account:read`; no shared Wallet registry change.
Allowed operations: freeze, unfreeze, recover, controls, topup-intent,
topup-confirm, authorization, capture, reverse, refund.
Digest: lower-case 64-character SHA-256 hex of the original body.
Query parameters are rejected. Existing request authentication, proof context,
owner/source/session/expiry checks remain applicable.

The backend reads only the owner's existing SQLite idempotency slot, checks the
original fingerprint, and returns operation/resourceId/idempotencyKey/digest plus
`status: UNKNOWN` or `status: CONFIRMED` with stored result. It does not submit an
approval, credit, ledger entry, event or new operation. Wrong owner, unsupported
operation and changed digest fail closed. The frontend treats CONFIRMED as a
reason to refresh current authenticated state, not as an independently spendable
historical balance. UNKNOWN enables a separately clicked same-body/same-key retry
after a fresh readback. Settlement and funding confirmation also check the
resource against the currently selected card before mutation.

Web recovery uses owner-scoped local storage; native recovery uses existing
SecureStore with WHEN_UNLOCKED_THIS_DEVICE_ONLY. Malformed records are retained
and actions blocked. History is bounded, never silently truncated. This does not
claim protection from a compromised browser origin or device.

## Concentrated evidence

- Backend: 118/118 passed, including original-slot readback after SQLite restart,
  no readback mutation, digest conflicts and cross-owner/scope denial.
- Existing Wallet/private UI cohort: 39/39 passed.
- Guest/Core/application/typography/recovery plus initial operations: 17/17 passed.
- Extended operation journey: 8/8 passed (includes the initial three, not eight
  additional independent tests).
- Frontend and server TypeScript checks passed before the final accessibility
  attribute addition; that addition has rendered-component test coverage.
- Full npm test source stage: 280/281 passed. The failed new test's hand-written
  expected value for 9007199254740993 YNXT is missing three zeroes. Actual parser
  result is 9007199254740993000000000000000000 wei. Product parsing is not changed.
  This failed full-suite run is retained and is not described as green.

Logs are under `apps/card/evidence/20261003-testnet-operations/`. Controlled QA
identities, approval authorities and Core fixtures do not prove user approval,
actual card creation, real Testnet funding or public business acceptance.

## Exact release dependency

The frontend accepted backend source pin remains
`e95fcf443228d0db97c139dfa5e8ad6fbb7aa675`; it is not weakened or relabelled.
The new backend/source must be independently admitted and deployed with a
corresponding exact owned consumer binding by the established release owner A.
A owns formal Web/native builds, signing and Host/public deployment. No global
Xcode selector changes, license auto-acceptance, signing credentials, alternate
Card deployment or DeviceHub calls were made.

After source admission, direct Testnet runtime evidence must cover actual
approved/rejected account/application, API-created card, exact verified YNXT
transaction credit, authorization/capture/reversal/refund conservation, statement
and audit readback, cold recovery, identity switch/logout, and Standard Wallet
survival when private services degrade. Source tests do not close those gates.

Public successor verified=false. User approval=false. Actual backend application
acceptance=false. Actual ACTIVE card=false. Real Testnet topup=false.
Real-world payments=false. ComputerControl=false. Native formal build/sign/upload
and installed lifecycle=false. Goal complete=false.
