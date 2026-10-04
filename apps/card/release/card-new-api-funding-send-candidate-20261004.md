# Card new-API funding send candidate

Product source `b4ccd17d6b01d1f40e1c998c454e4247e6935725`, tree `b2e5ad9af948e94e59c43e297b5541a1b1e26162`, branch `codex/card-test-service-recovery-20261002`.

## Implemented consumption

The actual private Card record list now renders `CardFundingSendExperience` for a pending new-API funding intent belonging to an ACTIVE card. It shows the exact sender, recipient, wei, chain and expiry. User selection consumes the existing owner wrapper around the accepted shared Standard Wallet discovery/connection bundle, with separate YNX Wallet and MetaMask candidates and ambiguity refusal. It restores existing approval only, never requests new accounts or signs a private session.

An explicit send click uses `sendExactCardFunding`, under an exclusive browser Web Lock. Before sending it checks actual approved `eth_accounts`, exact provider chain0x1917, current owner/session/source/intent and expiry, then confirms a durable local PENDING write by reading back its exact bytes. Only then does the existing shared StandardWalletConnection request the exact native YNXT Testnet transaction. The send record cannot credit a balance or grant authorization. Timeout, invalid hash or uncertain provider failure remain UNKNOWN; explicit4001 is REJECTED. Cold-start and concurrent attempts cannot automatically repeat the same intent. The actual returned hash is saved even before a later context check; no unconfirmed storage completion is reported as success.

A separate explicit Verify with Card API click calls the same source-bound `/api/card/v1/topups` for the exact original intent/hash/idempotency key. Only the existing validated backend receipt and parent authoritative refresh may expose credited state. No legacy `/app/card/v1/testnet/*` route is used by this new widget.

Labels/error states are provided in all twelve product locales. No account action, transaction, deep link, blank-tab launcher, standard disconnect or Product Session completion runs on mount. Existing unknown records are preserved. Unsupported exclusive storage keeps the send closed. Journal recovery is historical evidence only, not authority to resend or an account/approval proof.

## Evidence

29/29 funding primitive + existing private client/Guest tests passed; 3/3 actual new React widget tests passed; frontend/server typecheck passed. SDK and provider transports in these tests are software fixtures. UI tests distinguish wallet selection, sending and Card verification, preserve UNKNOWN through cold start, and keep dynamic Chinese error copy in the selected language. No installed-wallet or actual funding claim follows from these tests.

Exact-source Web build, nested envelope remote build16/16 and static parity13/13 passed. Matching backend main282228B/SHA256 `035e5e585c9c70cfaac93a79c236c8e54bf3915c0f2cfb5b6ae4e9d75694ac31`;20 source inputs/15 external imports; compiled source identity. Backend not started and SDK not executed outside software test seams. Full artifact/source hashes are in `paired-composition-b4ccd17d6-20261004.json`.

Preserved candidate root `/private/tmp/ynx-card-paired-candidate-20261004.0FYT51`, envelope `envelope-b4ccd17d6`, backend `backend-b4ccd17d6`. Earlier candidates/failure logs are untouched.

## Open gates / limitations

No deployment/alias/Host mutation, actual account approval/rejection, real signature, testnet send, Card receipt, private-service lifecycle or Data Fabric readback in this batch. Formal protected runtime still needs genuine captured-current and accepted Wallet/Auth role/actor inputs. No fake current producer or local processor fallback is used. Public source-bound installation and direct user flow remain unverified.

The new send path is currently Web-only with browser Web Locks; native transport/durable exclusive storage is not admitted. The current widget's native chooser buttons return without a send rather than presenting a fully usable native flow. Native availability/disabled feedback needs its own follow-up correction and tests before any native candidate promotion. Do not claim native send support.

The full real Testnet funding lifecycle is NOT_VERIFIED, and the complete product goal remains open. `realWalletApproval`, `realSignature`, `realYNXTTopup`, `realCardApiReadback`, `realPrivateApproval`, `publicRuntimeVerified`, `productsConnected`, `migratedV2`, `ComputerControl` and `productionRealPayments` remain false. No PAN/CVV, fiat or real merchant payment.

The new public product-microsite requirement has been read and queued after this atomic funding checkpoint. It does not replace the existing app or justify exposing private data/automatic wallet actions on an introduction page.
