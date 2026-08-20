# Exchange Product Session v2 adapter checkpoint — 2026-08-20

Scope: `apps/exchange/**` only. This checkpoint consumes the source-pinned
Wallet/Auth package built from `203be5e108be468350591615a64d5d36ab87a8f1`
(69 files, 123903 bytes; SHA-256
`8d0e8e35d8f387948d44666efdc6322e9b57968b5987728dffbddd11b54928eb`).

## Adapter boundary

- Standard EIP-1193 Wallet connection remains independent and usable when the
  optional private Product Session is degraded.
- The only private-session construction path is
  `createProductWalletConnection`. It accepts OS-protected signing/storage and
  platform opening capabilities only; it does not accept a Gateway endpoint,
  callback, origin or session injection.
- The root factory owns the fixed authoritative origin
  `https://wallet-auth.ynxweb4.com` and derives the v2 routes. The
  Exchange-owned registry is a source-pinned projection for `exchange`.

## Verification performed

- `npm run typecheck` — pass.
- `npm test` — pass (9/9).

## Truth status and remaining proof

`migrated-v2=false`. There is no runtime root-factory proof, public v2 route
proof, installed/browser approval, rejection, timeout, revoke, second-launch,
or network-loss Retry proof in this checkpoint. Therefore it does **not**
assert a private session, public deployment, hosted download, production
signature, or store release. The next safe proof requires an installed Exchange
candidate with its real OS-protected signer and an unlocked Wallet runtime that
accepts the registered v2 Exchange schema.
