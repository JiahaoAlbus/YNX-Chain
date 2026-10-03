# Card owner direct public stable verification

The exact public source is `66126513738ecbd77a372d2ab7f5ac34076c2208`, tree
`18e8c7c32f887d0bc34bd2c6182e7e7199b909fd`. This is not the newer operations WIP
`1a96774a2ee95184cf0472bc66b9d38aa099b549` and is not claimed to include that WIP.
No deployment or alias change was performed by this consumer verification.

## Owner-observed HTTP/source identity

Independent direct origin fetches (no redirect, bounded 20-second timeout) matched
A's published exact pins:

- Apex HTTP 200: 1838 bytes, SHA-256
  `f33ccc24476aca72db95774e697b955b1ca2b74130cd6f8c677cdd964d060447`.
- Runtime identity HTTP 200: 816 bytes, SHA-256
  `14f9e45c26880e1026fc846d2f438cc03c7ea7e1197057dea99784391a75673a`;
  exact source/tree above, version 1.0.0, testnet-release, chain 0x1917,
  paymentNetwork simulation and productionRealPayments false.
- Browser-loaded JS HTTP 200: 4443645 bytes, SHA-256
  `f205405892d5b4c904cbe82781b6c19cb8bf7071eb15026326dfd7823039757a`.
- Backend `/api/card/v1/version` HTTP 200: 255 bytes, SHA-256
  `f2e86532b2da21f83bfa15e6b304fc76a4f86ff4c629a5a1c80064cbfd155e5e`;
  exact accepted backend `e95fcf443228d0db97c139dfa5e8ad6fbb7aa675`,
  configurationReady true, runtimeFundingVerified false, real payments false.

Full response headers and Vercel request IDs are retained in
`evidence/20261003-testnet-operations/public-661265-http-readback.json`.
This verifies the four fetched resources, not an independent 13-resource audit;
A's own 13-resource readback remains a separate publisher observation.

## Direct browser observations

The owner reloaded the original Codex In-app Browser tab at
`https://card.ynxweb4.com/?verify=card-inventory-20260831`.
Actual rendered document lang=en, title `YNX Card | 1.0.0`, no visible CJK.
This was an existing profile, not proof of first-ever clean-profile startup.

Opening Choose a wallet revealed separate YNX Wallet logo/name and MetaMask fox
logo/name. MetaMask copy identifies io.metamask and states it never uses the YNX
route. No-provider fallback says missing announcement is not proof of uninstall,
with real download/install links. Only the chooser was opened: no selected
provider, extension discovery success, Hosted popup, approval or account request
is inferred. Before/after tab count remained 1, same URL. This is IAB evidence,
not a claim of real Chrome extension or device verification.

Clicking Start application while disconnected showed the explicit Standard Wallet
requirement, with no card or balance created. All six navigation tabs were
actually selected at 1440x900. Try demo selected Activity and recorded only a
labelled local DEMO event, with no transaction/balance/merchant settlement.
The same page was inspected and captured at 390x844; all six tabs remained
visible. Temporary viewport override was reset. No warning/error console entries
were observed in this bounded flow.

AX observations, navigation states, console samples and screenshots with SHA-256
are retained under `evidence/20261003-testnet-operations/public-661265-*`.

## New owned client tests (not a public successor deployment)

`cardBusinessClient.test.ts`: 18/18 passed, including four new tests for fixed
read-only original-operation routes, exact key/digest/resource binding, historical
result not becoming current state, incomplete authorization receipt rejection and
malformed capture/reverse/refund receipt rejection without silent replay.
These tests cover controlled API responses. They do not validate a live private
operation. The previously retained failed amount-test expectation still prevents
a full-green WIP candidate; no test was deleted or weakened to promote it.

## Remaining full-flow requirements

Real account approve/reject, actual provider chain add/switch/readback,
refresh/events/disconnect/revoke, actual Hosted/private capability, backend
application acceptance, API-created ACTIVE Testnet card, real YNXT Testnet
transaction/credit, public authorization/capture/reverse/refund and cold business
recovery all remain unverified. No account request/sign/send was triggered.
The new API/operations successor still needs exact backend admission and A-only
source-bound formal release. Real issuer, PAN/CVV, fiat and real merchant payment
are outside Testnet scope, not prerequisites for Testnet completion.

Full public journey complete=false. Native installed lifecycle=false.
ComputerControl=false. Real payments=false. Goal complete=false.
