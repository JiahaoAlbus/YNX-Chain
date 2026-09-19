# Weekly v3 cross-product integration checkpoint

## Scope and recovery

This runner adds integration assets only. It never edits Finance or Wallet
product source, calls an official Broker endpoint, changes DNS, deploys, or
touches existing chain/account state. Go `-overlay` injects the test into a pinned
Finance checkout; all Finance state and HTTP/TLS listeners are temporary.
The preserved implementation baseline is network `79af8b249`, Finance
`cf89d852c9f8630e1980d9f0418adc901053835f`, Wallet
`ab4dfa927be3d16fde3048b72d705d90c770dcd3`.
Finance is actively fixing the findings below in its owner tree. A detached
read-only snapshot at `/private/tmp/ynx-weekly-v3-finance-baseline.9XQFci/finance`
preserves reproducibility of the original failures. Do not reset the owner tree
to reproduce them. The unrelated Wallet artifact-manifest dirty file is untouched.

## Reproduce

From this network worktree:

```sh
node scripts/verify/weekly-v3-finance-wallet-integration.mjs \
  --finance-worktree /path/to/exact-finance-checkout \
  --finance-commit cf89d852c9f8630e1980d9f0418adc901053835f \
  --wallet-worktree /path/to/exact-wallet-checkout \
  --wallet-commit ab4dfa927be3d16fde3048b72d705d90c770dcd3 \
  --diagnostic-date-adapter true \
  --output /path/to/new-evidence.json
```

`--diagnostic-date-adapter true` is ONLY for isolating downstream defects in the
broken original Finance build. The real browser scope/time/manual/AI checks never
use it. After Finance fixes its boundary, OMIT this flag and test its new exact
commit: the normal/default mode makes no timestamp conversion outside product
code. The report records adapter use and SHA-256 hashes of the integration assets.
An existing output is never overwritten. Dirty or changed product sources fail
the checkpoint guard. A failing test yields nonzero, not an acceptance result.

## What executes

- Actual `app.js` API/form/AI-copy handlers in a minimal browser VM, not source
  regex assertions. AI input is a labelled fixture; no real AI generation claim.
- Actual Finance `order-wallet.js` bundle, fixed callback transport and actual
  Wallet controller, with the frozen public test key, fixture secure storage,
  fixture trusted time and a simulated callback delivery failure.
- Real Finance HTTP routes with an explicit scope-aware authority decision
  fixture, real signatures, order challenges, CAS, persistent store and reopen.
  This is not a deployed Product Session authority or installed Wallet UI test.
- Actual Alpaca adapter to a loopback TLS provider fixture. The socket is pinned
  to localhost and trusts the fixture certificate; TLS verification is not
  disabled. Synthetic credentials and a synthetic activation receipt exist only
  in the test. No official Alpaca call is made.
- Submit ACK, accepted-but-dropped HTTP response, query/reconcile, cancel ACK vs
  final cancellation, persistent reopen and restart-during-dispatch fencing.
- Negative delayed-event, identity mismatch, expired approval and provider-shaped
  event parsing checks. These intentionally remain red on the original build.

## Findings on Finance cf89d852 / Wallet ab4dfa927

| Finding | Reproduced effect | Owner |
| --- | --- | --- |
| Browser scope | Both challenge and callback request portfolio.read; HTTP routes require profile.write, producing 403 | Finance |
| Authority time | Actual server JSON timestamp passed to SDK requiring Date produces INVALID_TIME | Finance |
| Unused revocation callback | Wallet creates revoke; Finance cannot parse it without the previous approval proof | Finance, shared protocol review if needed |
| Delayed event | fill/event-2 followed by old new/event-1 regresses filled to submitted and reverses cursor | Finance |
| Reconcile identity | Same client ID but wrong asset, symbol, side and quantity is accepted as filled | Finance |
| Expired outbox | Approval expires 09:05:30; dispatch at 10:00:30 still sends provider POST without fresh execution evidence | Finance |
| Provider event DTO | Order fields used by the adapter's own provider HTTP format are rejected by the SSE decoder expecting internal camelCase; complete official SSE envelope still requires owner verification | Finance |

Manual and AI-copied draft launch both reproduce the same scope blocker; they
are not additional independent defects. All findings were sent to the original
coordinator, who controls the Finance repair window. No owner source was patched
by integration.

## Results and truth boundary

Evidence: `release/evidence/weekly-v3-cross-product-cf89d852-failures-20260919.json`.
Cross-product acceptance FAILS. With the explicitly recorded Date adapter only,
approve/reject → real callback validation → durable CAS/replay checks pass.
Actual adapter submit, lost-ACK unknown → query, cancel, reopen and interrupted
dispatch tests pass against the local TLS fixture, exactly one provider POST per
logical order and one DELETE for a cancellation. These partial results do not
override the failed complete flow.

Independent owner regressions: Finance internal/brokerage Go race tests and
Finance command race tests pass; all 54 Finance front-end tests pass. The first
command used nonexistent root `cmd/*` paths and failed setup; it is not counted
as a successful command. Correct command paths are `./apps/finance/cmd/...`.
The network/Wallet gate passes 38 endpoint/profile tests, Faucet race tests with
40-user shared-alias recovery, SDK backward compatibility, chain metadata,
19 approval/transport tests, 67 Wallet extension/provider tests and 142 Wallet
controller/time/Faucet tests. Its separate evidence remains local-only.

| State | Result |
| --- | --- |
| Code | Integration regression assets implemented; product owner fixes pending |
| Contract/local | Network/Wallet and owner regressions pass; complete cross-product flow FAILS |
| Official Sandbox | false — credentials and explicit bounded verification permission pending |
| Public deployment | false for weekly checkpoints |
| Public verification | false; no alias activation or installed Wallet acceptance |
| Production approved | false; Mainnet and live trading disabled |
