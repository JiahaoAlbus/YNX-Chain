# Next Action

Highest-priority bounded delivery (2026-07-15):

Current single action: expose the existing persistent Square comments, reactions, follows, and reports through the signed native client, then consolidate feed, Chat, contacts/follows, and notifications into one App-native Social domain. Do not turn every backend service into a bottom-tab item.

Why this is next:

- Installed Android proof now covers a real multi-device Chat message, two-recipient decryption/read state, reload, biometric device rotation, revoked/active directory state, reconnect, and a post-rotation message.
- Direct Chat is still not a complete social product. Square already persists signed comments, reactions, follows, and reports and App Gateway already allowlists those exact routes, but the native App does not expose those workflows. Contacts, notifications, richer profiles, moments-style publishing, moderation outcomes, and Trust/appeal integration remain absent.
- The current App has already reached five tabs. Adding AI, IDE, Shop, Bank, Browser, Bridge, Trust, and every other service as peers would produce shallow screens and prevent complete workflows.
- `docs/ecosystem/PRODUCT_ARCHITECTURE.md` defines the product boundary: YNX App owns high-frequency consumer identity/social/wallet/Pay; Explorer, Developer Suite, Browser, and merchant operations are separate applications; backend services receive windows only after a real workflow exists.

Files to touch:

- `internal/square` and `cmd/ynx-squared` only if an audited existing API contract has a real correctness or access-control gap
- `internal/appgateway` only if an exact existing protected route or response-boundary gap is found
- `apps/mobile` for the native Social information architecture and signed workflows
- `internal/trustgateway` and existing Trust handlers only where report/appeal evidence requires a real integration
- API and acceptance documentation only after matching code and tests exist

Required implementation:

- Reuse the existing persistent signed Square comment, reaction, follow, and report APIs; do not duplicate their domain state or handlers.
- Add strict native client request/response types, parsers, signatures, authorization-failure handling, and tests for those exact Gateway routes.
- Add only the missing member-scoped profile or notification records needed by a complete native workflow, with persistence, access control, restart integrity, and tests before exposing them.
- Connect reports and moderation outcomes to the existing Trust appeal/transparency boundary; rejection and appeal state must remain visible and auditable.
- Build an App-native Social route that groups feed, Chat, contacts/follows, and notifications with native nested navigation or segmented controls. Keep the bottom bar stable and do not copy the Web layout.
- Preserve `ynx1...` as the visible identity default and YNXT as the only native coin/resource asset.
- Keep Pay/tips disabled until an exact recipient-bound consumer payment and receipt workflow is connected to the social action.
- Add API documentation only after matching handlers, persistence, tests, and smoke targets exist.
- Update the official website only with implemented capability and truthful deployed/not-deployed status; do not represent the architecture document as shipped products.

Validation commands:

- `go test ./...`
- `make square-api-check`
- `make chat-api-check`
- `make trust-api-check`
- `make trust-appeal-check`
- `make transparency-report-check`
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

- Two disposable `ynx1...` users can use the native client to follow/unfollow, publish, comment, react/unreact, report, and read the resulting real feed/profile state after service restart; notification state is required only if its persistent backend is implemented in this slice.
- Changed-input idempotency, duplicate reactions, unauthorized deletion/moderation, overlong content, rate abuse, hidden/revoked identities, and malformed signatures fail closed.
- The installed native App exposes a coherent Social workflow rather than a list of service buttons, and all remote claims match exact deployment evidence.
- No groups, moments equivalence, media, public Pay/tip settlement, iOS/real-device, production signing, store acceptance, audit, or independent proof is inferred unless separately verified.

Explicitly not doing / truth boundaries:

- Do not add fake Bank, Shop, Browser, Bridge, AI, IDE, desktop, group, media, contact, moderation, or moments screens. Build each later as a complete domain workflow or separate application under the architecture boundary.
- Do not claim WeChat/Binance/Apple equivalence, mainnet, exchange listing, stablecoin issuer support, wallet default support, store acceptance, partnership, public settlement, or independent proof without evidence.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifacts, or IDE execution except to preserve passing tests.
- Do not modify or replace the long-term goal file.
