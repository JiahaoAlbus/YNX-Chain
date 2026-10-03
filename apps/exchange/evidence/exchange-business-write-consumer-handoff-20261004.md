# Existing Exchange action closure: consumer handoff v1

Reviewed owner source: 3eb3a00499fd3678a6b17999a6a3395bcc558396, tree 723094499262d27f6918f2d18d1b9fbf8f102644. Scope is the existing Exchange spot/account experience, not new DeFi, derivatives, native protocol or permission authority. A remains the sole shared Wallet/Auth/SDK/permission/Host release owner.

## Exact current blocker, not a credential request

The existing Web consumer requests only `exchange:read`. `authorizeBrowserReadV2` in `internal/exchangeproduct/session_v2.go` allows only GET `/v1/account`, `/v1/margin/account` and `/v1/solvency/liability-proof`; a v2 proof sent to other business routes is rejected with `EXPLICIT_ROUTE_SCOPE_UNAVAILABLE` before legacy fallback. `auth` also restricts its v2 context to read permission. These are intentionally retained, not missing product engine implementations.

The current Web `reviewOrder` performs a public rules refresh and exact-money preview only. Its action paths call `requireProductSession()` and do not sign or POST. Expanding the read scope in this owner or sending v2 proof to legacy v1 routes would not create the required shared write producer. Native account, verified actor, operation-bound approval, fresh business preview and durable unknown-effect readback must be supplied through the accepted shared interface. A's currently active Pay producer is not an accepted Exchange producer.

## Existing business seams to consume, not a new SDK

Paths below are existing server paths (the Web host currently uses its `/api` mount). A must independently bind the actual release mount/origin rather than derive or override endpoints in the consumer.

| Existing operation | Business path and method | Existing handler requirement / body |
| --- | --- | --- |
| Place reviewed limit order | POST `/v1/orders` | `exchange:trade`; `market`, `side`, `type`, optional `timeInForce`/`postOnly`, integer `priceMicro`, integer `amountMicro`, `idempotencyKey`, `walletSignature` |
| Cancel one owned order | POST `/v1/orders/{id}/cancel` | `exchange:trade`; `idempotencyKey`, `walletSignature`; exact owned order ID |
| Deposit intent | POST `/v1/deposit-intents` | `exchange:deposit`; `idempotencyKey` |
| Record already sent deposit | POST `/v1/deposits` | `exchange:deposit`; `intentId`, `txHash`, `idempotencyKey`; this does not send a transfer |
| Refresh deposit observation | POST `/v1/deposits/{id}/refresh` | `exchange:deposit`; existing owned deposit ID |
| Withdrawal review | POST `/v1/withdrawals/review` | `exchange:withdrawal-review`; `asset`, `network`, `destination`, integer `amountMicro`, `idempotencyKey`, `walletSignature`; review is not successful chain dispatch |
| Security preference | PUT `/v1/security` | Legacy handler uses `exchange:read` and `SecuritySettings`; not permitted by the current v2 read route allowlist |
| Support case | POST `/v1/support` | Legacy handler uses `exchange:read`; `category`, `message`, `idempotencyKey`; not permitted by current v2 read route allowlist |
| Existing optional AI draft | POST `/v1/ai/drafts` | `exchange:ai`; `kind`, `prompt`, `contextClasses`, explicit `permission`; must preserve existing availability and privacy rules |

These handler scope names describe existing requirements, not authority to register or grant them. The consumer must not infer that a read proof authorizes support/security writes merely because the old handler used read scope.

Signature input is already implemented by `OrderAuthorizationPayload`, `OrderCancelAuthorizationPayload` and `WithdrawalAuthorizationPayload` in the owned engine. Their native-wallet verification must not be replaced with arbitrary MetaMask `personal_sign`, fabricated signatures, or duplicated frontend protocol. The shared producer must return its accepted exact operation/actor/signature binding, reconcile unknown effects and provide the applicable caller interface; the consumer then uses it rather than inventing a second SDK.

The public preview supports the versioned limit-rule contract only; do not expose unaccepted advanced/market order choices based solely on engine methods. Six decimal inputs, floor-micro notional and per-fill ceil-micro fees are genuine engine semantics. A preview is not a reservation and per-fill rounding may require atomic rejection; do not report balances spent until committed owned readback.

## Required shared delivery and subsequent owned work

Return exact accepted source/package checkpoint, exported factory and literal callable contract, permitted product operation IDs/scopes, current actor binding and change/revoke behavior, business preview/approval binding, idempotent dispatch and original-effect readback, error classification and actual compatible runtime mount/version. Preserve the existing `DeployedPublic && !StrategyVaultExecutionEvidence` execution fence; a producer alone cannot establish the required product custody/settlement evidence.

Once delivered, this owner can wire the existing buttons, persist unknown intent per exact actor, show preview/fees/risk before explicit confirmation, recover from interrupted response with original-effect readback, and render confirmed order/deposit/review results. Complete source, public runtime and native/browser user journeys are separate gates; no accounts, signatures or transfers are requested by this handoff. No user private key or credential is needed to define/implement this missing shared contract.

## Local projection evidence

The extended owned PostgreSQL cancellation integration checks a partial match, twelve duplicate cancellation requests across two OS processes, restart, exact owned replay and foreign rejection. Guest snapshot after restart must contain exactly the persisted fill/source digest, empty cancelled depth and no account/signature fields. All six existing candle intervals must have exactly one candle/one fill with native volume 1 and test-credit notional 2; cancellations and reads must neither fabricate volume nor change persisted state. Executed results are recorded below; this is loopback QA, not public market or real Wallet proof.

The test also launches two separate Node consumers using the actual owned `createMarketFeed` and `aggregateRetainedCandles`: real loopback HTTP snapshot, no credentials, offline state, explicit HTTP retry, unchanged match/source digest/revision and depth, PostgreSQL multi-instance provenance, no invented volume. Backend tests cover six intervals; the existing Web selector/aggregator covers its three declared intervals. The first new fixture incorrectly requested all six in the Web aggregator and failed with `MARKET_DATA_INVALID` (4.631s); it was corrected to use exported `CANDLE_INTERVALS`, not by widening product logic or hiding the failure.

Final extended PostgreSQL/OS-process/Node-consumer focused race regression: three repetitions PASS, 12.571s. Complete Exchange race regression with real PostgreSQL enabled: PASS, 38.316s. Node syntax and diff checks PASS. Isolated schema count zero; retained loopback QA database stopped after completion. Production code and shared authority are byte-unchanged in this checkpoint. There is no installed Chrome UI/public deployment/real account or signature evidence in this new test; prior browser-specific evidence remains independently labeled.
