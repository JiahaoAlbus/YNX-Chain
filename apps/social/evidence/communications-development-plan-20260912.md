# Social communications development plan

## Current source inventory

- Native client: apps/social/App.tsx, src/api.ts and src/chatCrypto.ts. Source includes device-specific encrypted envelopes, sender signatures, group creation/member APIs, encrypted attachment upload/download, contact permissions and dual-authorized device rotation. These are source observations, not end-to-end service acceptance.
- Backend candidates: internal/social and internal/chat. These paths exist in the owner repository but implementation, runtime topology and concurrent ownership still need coordination before changes.
- Web: separate codex/social-provider-lifecycle-20260912 branch. Wallet controls are public discovery/connection UI, not a complete messaging client.
- The client currently decrypts attachments to verify them but only shows an alert; a usable attachment viewer/save flow remains missing.
- Existing envelope encryption does not establish a reviewed ratchet, forward secrecy after recipient key compromise, post-compromise recovery, key transparency, or metadata privacy.

## Implemented in this development pass

- Explicit Web network switch with 4902 add/switch/readback, rejection reporting and visible connected status.
- Web UI intent guards, manual local-disconnect persistence within a tab and honest unsupported-revoke guidance.
- Native ciphertext outbox changed from one overwriteable record to a bounded queue partitioned by account, device and conversation. Acknowledgement removes only the exact message. Queue recovery occurs before network fetches.

## Target boundaries

Message bodies, attachment keys, private keys and contact/group relationships must not be public chain data. Chat transport stores ciphertext with explicit retention and delivery rules. Chain use is limited to necessary identity/authorization proofs and separately confirmed settlement. Cloud receives encrypted objects; decryption keys travel inside authenticated encrypted messages. Payment handoff contains an explicit recipient, amount, asset and network, and requires Wallet confirmation; opening a chat never starts a payment.

Device identity, recovery and Wallet sessions use owner-approved shared contracts. Social controls local UI and message scheduling, not a replacement Wallet authority. Avoid claims of superiority to Telegram until properties and adversarial scenarios are independently demonstrated.

## Continuous implementation order

1. Reliable delivery: durable atomic outbox writes, recipient-device epoch checks before retry, encrypted offline drafts/cache, explicit pending/failed/sent states, cancellation and deterministic retry. Current queue still needs crash-safe storage and device/membership-change handling. It stores ciphertext but does not encrypt routing metadata at rest. Legacy records without sender-device binding remain preserved, not automatically transmitted.
2. Conversation synchronization: server cursor pagination, stable ordering/deduplication, reconnect catch-up, bounded retention and per-device delivered/read acknowledgement policies. Existing read-on-load behavior needs a user-controlled receipt policy.
3. Group security: owner/admin/member roles, invitation and join rules, signed membership epochs, removed-device exclusion, rekeying and recovery. Verify backend enforcement independently of UI.
4. Attachments: offline encrypted upload queue, resumable transfer, content integrity, actual safe viewing/export and revocation/retention semantics. Coordinate encrypted object capabilities with Cloud.
5. Device lifecycle: device inventory, revocation, recovery and new-device history grants. Coordinate immutable identity/recovery SDK with Wallet; do not silently grant old history.
6. Ecosystem handoffs: Cloud private-file sharing and Finance payment requests with explicit consent, origin validation, expiry/replay binding and return-state handling.
7. Full runtime validation after feature development: two people/multiple devices, offline/reconnect, group removal, key rotation, stolen-device simulation, attachments, Wallet/MetaMask on 6423, real external DApps and WalletConnect. Keep source, installed, public, session and business results separate.

## Cross-owner dependencies

- Wallet: shared silent restore, explicit independent provider selection and revoke outcome contract; device identity/recovery versioned handoff.
- Cloud: authenticated encrypted upload/download capabilities, expiry/retention and resumable transfer contract.
- Finance: signed payment request/return contract and testnet settlement boundary.
- New audit coordinator: coordinate backend path owners and deployment/environment work; existing system access refusals remain in force.
