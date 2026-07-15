# Next Action

Highest-priority bounded delivery (2026-07-15):

Current single action: deploy the exact multi-device Chat/App Gateway release with scoped rollback, prove the new routes without creating public conversation/message state, then obtain installed disposable multi-device execution evidence before expanding Chat features.

Why this is next:

- Multi-device envelope fan-out, sender continuity, per-device acknowledgements, sender signatures, bounded rotation/recovery, Gateway routes, shared Go/mobile vectors, 43 mobile tests, and dual Hermes exports now pass locally.
- Public Chat `f81f3b6cabe2` and Gateway `376c95793d66` still run the prior single-envelope protocol. Until exact binaries are deployed and health/routes are verified, v2 is not a remote capability.
- Android installed proof currently covers navigation/rendering only. It does not prove two authenticated devices can exchange and reload one v2 message through the real deployed path.

Files to touch:

- exact-release Chat and App Gateway binaries plus their preserved remote env/unit/state boundaries
- scoped backup, health, route, and signed-session proof artifacts
- `docs/acceptance/PROJECT_STATE.md`, `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, and this next-action record after real evidence exists

Deployment and proof scope:

- Commit the exact passing source and build `ynx-chatd` plus `ynx-app-gatewayd` with that release identity.
- Preserve existing env files, service units, mode-`0600`/`0700` state, Square/Pay services, chain runtime, and public ingress.
- Create recoverable scoped backups, validate both binaries against preserved env, restart only Chat and App Gateway, and poll loopback/public health for exact build identity.
- Verify unauthenticated rotation/list routes fail closed and an operator-controlled signed session can perform empty conversation/device/rotation reads followed by device/session cleanup. Do not create a public conversation or message during deployment proof.
- Build/install the exact test-only native package separately. A later disposable two-account/two-device message proof must verify sender continuity, per-device decrypt/read state, restart/reload, rotation, cleanup, and zero plaintext server persistence. It is operator proof, not independent or production proof.

Validation commands:

- `go test ./...`
- `make chat-api-check`
- `make app-account-ownership-check`
- `make app-gateway-check`
- `make mobile-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`

Completion standard:

- Public and loopback health report the exact committed Chat/Gateway release with preserved state modes and healthy Square/Pay upstreams.
- Rotation and rotation-list routes are present and fail closed without ownership/device authorization; signed empty reads and cleanup succeed without creating conversation/message state.
- The exact test-only native package is separately buildable; installed authenticated multi-device execution remains the next proof until actually completed.

Explicitly not doing / truth boundaries:

- Do not claim v2 remote support before exact release and route evidence.
- Do not claim a public/installed message before the message exists, decrypts on every intended device, survives reload, and is cleaned up or explicitly retained as proof state.
- Bounded recovery requires an active authorizing device. All-devices-lost recovery, social recovery, owner custody handover, hardware custody, groups, contacts, attachments, Pay/Trust/appeal integration, moderation, iOS/real devices, production signing, stores, audit, and independent proof remain incomplete.
- Do not add fake Bank, Shop, Bridge, AI, IDE, desktop, group, attachment, contact, or moderation screens.
- Do not claim WeChat equivalence, mainnet, exchange listing, stablecoin issuer support, wallet default support, store acceptance, partnership, public settlement, or independent proof without evidence.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
