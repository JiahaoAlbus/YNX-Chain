# Card sandbox recovery and minimum durable backend

This slice changes `apps/card/**` only, recovered from source
`bbe527dcf3d4566a985172bbe76fc99cb3b61c06`, tree
`18df0e705afc7dcbb43ded2ca49f322a9a679b0f`, remote branch
`codex/card-lifecycle-preconditions-20260831`. The isolated implementation branch
is `codex/card-sandbox-recovery-20260906`; the conflicted 06-card worktree and
archive-only source31b remain untouched. The parent authorized owner recovery.

## What runs today

`App.tsx` calls `src/api.ts`, whose base comes from the configured Gateway.
It never instantiates `TestnetSimulationProcessor`; only its local tests and
Data Fabric simulation tests instantiate that class. The processor is volatile
simulation code, not a network server or a durable account store.

The following HTTP paths are **frontend expectations**, not verified deployed
Card backend interfaces. They all use the `/app/card/v1` prefix:

| Method and suffix | Expected operation |
| --- | --- |
| GET `/account/state` | Session owner's cards, controls and ledger |
| POST `/card/applications` | Sandbox application |
| POST `/cards/:id/actions` | Activate, freeze, unfreeze, close or replace |
| PUT `/cards/:id/controls` | Owner's controls |
| POST `/cards/:id/disputes` | Dispute record |
| POST `/testnet/topup-intents` | Fixed owner, recipient, amount and expiry intent |
| POST `/testnet/topups` | Submit only intent ID and transaction reference |
| POST `/cards/:id/simulation/events` | Simulated merchant lifecycle |
| POST `/ai/runs`, `/ai/runs/:id/review` | Optional explanation/review |

The recovered source and current main were searched for these routes and for
Card server implementations. They have no matching backend. In the recovered
source, `internal/appgateway/{gateway,server}.go` owns generic Gateway routing;
it has no Card service mapping. No shared Gateway/Auth/Chain source was modified.
This bounded search is not an assertion about every untracked worktree or an
unidentified remote service. A public 401/404 or missing runtime identity alone
cannot establish backend ownership or source identity.

## Minimum next implementation boundary

The Card-owned implementation can live in `apps/card/server/**`, with its own
tests and schema migrations. It needs a transactional persistent store and
the following schema/behavior before any live funding claim:

1. Derive owner exclusively from a verified current Product Session. Never use
   a body `walletAddress` or `cardAccountId` as authority. All reads, writes,
   references and composite foreign keys include owner. A Gateway integration
   change belongs to `internal/appgateway/**` and requires the root/owner's
   separate merge; Card must not patch that shared path opportunistically.
2. Store accounts/cards/controls, top-up intents, funding claims, authorizations,
   captures, refunds, immutable ledger entries, idempotency results and an outbox.
   A single database transaction reserves the canonical request fingerprint,
   applies checked balances and inserts ledger/outbox rows, then commits before
   responding. Preserve these together on cold restart. Concurrent same-key
   requests return one committed response; changed payload gives 409. Two keys
   for one owner/chain/tx cannot credit twice. A global unique `(chain, txHash)`
   funding claim plus validated sender protects cross-owner assignment too.
3. Generate expiring top-up intents server-side. Pin the owner, chain6423,
   approved recipient and exact amount before Wallet opens. Proposed v1 accounting
   scale is 100 minor units per YNXT; the existing API's `amountWei` must be an
   exact multiple of 10^18 because the current native ledger transfers whole YNXT.
   Convert with integer arithmetic and reject values above safe ledger capacity.
   This scale is a proposed server contract, not a claim of an existing converter.
4. Consume CORE source0468's exact `ynx-local-durability-v1` capability and mined
   receipt contract. Validate exact fields/encodings, transfer type, hash, sender,
   recipient, amount, fee and nonce representation, inclusion and checkpoint
   bindings. `status:0x1`, a hash or a confirmation counter alone cannot credit.
   Unsupported, pending_durable, uncertain, memory_only and not_found stay
   uncredited/retryable. Durable means local snapshot durability; consensus
   finality and replication remain false. No frontend claim can bypass this gate.
5. Merchant authorization/capture/reversal/refund routes use owner+card references,
   a server clock and expiring holds. Freeze blocks new spending; closed is
   terminal; prior valid refunds remain allowed. Enforce integer capacity and
   daily/monthly/velocity controls in the same serialized transaction as balances.
   The existing generic simulation payload lacks authorizationId/captureId;
   add those explicit references before mapping capture/reversal/refund to a
   durable implementation. Do not infer a prior authorization from a merchant name.
6. Prove fresh restart, write failure before commit, concurrent duplicate tx/key,
   idempotency conflict, cross-owner reads/references, expired intents/holds and
   no ledger mutation for uncertain CORE proofs in a synthetic local server.
   Add a bounded real protected-state test only after such a store exists.

The first backend increment should implement account state, a server-owned intent,
durable proof admission, controls and a complete local merchant settlement ledger;
optional AI/disputes must remain unavailable until their own routes exist.

## Remaining product gates

The vendored Wallet dependency is still `98c6d5d7-provider` and the coordinator
contract is old. The earlier Begin+Retry race, SDK529 complete-package migration,
0468 proof consumption, session logout/retry behavior and installed/public Card
acceptance are not closed by this processor change. Public funding, signatures,
broadcast, persistent backend integration and real merchant payments remain false.
Data Fabric output remains explicitly `testnetSimulation:true`.

Future Card page acceptance must use white and Klein blue `#002FA7` throughout;
gray is auxiliary text/dividers and red/yellow/green only semantic states. This
slice does not change UI, publish a page, connect a wallet or send a transaction.
