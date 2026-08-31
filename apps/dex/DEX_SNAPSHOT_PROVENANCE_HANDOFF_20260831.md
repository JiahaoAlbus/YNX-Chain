# DEX snapshot provenance handoff — 2026-08-31

## Source checkpoint

- Source commit: `9feeb64acb7aeb857f3d2e1cedc741116cf4abfa`
- Branch: `codex/dex-c7-four-path-manifest-20260831`
- Product scope: `apps/dex/**` only
- Local verification: `npm test` passed 30/30; `npm run build` passed.

## Read boundary

`loadDexSnapshot` now returns one immutable snapshot-wide provenance record:

```text
source=authoritative chain-native YNX Testnet state
asOf=the accepted gateway updatedAt timestamp
version=native-dex-schema-v1
classification=testnet
status=live
coverage=native-snapshot-assets-pools-events
latestBlock=the maximum committed asset, pool, or event block
```

The source is accepted only when the native snapshot is parseable, has the
exact authoritative source label, contains arrays for assets, pools and events,
and is no more than 15 minutes old. Metrics, price points, candles and route
quotes are derived from that same snapshot. This is a read provenance boundary,
not a price guarantee, a wallet identity assertion, or a trading permission.

## Central integration contract

Central/Oracle/Indexer owners must preserve the exact native snapshot envelope
or issue a versioned migration. A changed source label, stale `updatedAt`,
missing collection, unsafe integer, or unsupported state fails closed before
the DEX renders a quote or metric.

`status=live` means only that the bounded source was fresh at the local read;
it does not establish public deployment, a public indexer SLA, Wallet approval,
or a Testnet transaction.

## Truth state

`implementedLocal=true` and `testedLocal=true` for this source slice only.
`integratedCentral`, `deployedStaging`, `deployedPublic`, `installedLocal`,
`downloadHosted`, `productionSigned`, `storeReleased`, Wallet approval,
signature, token approval, swap, liquidity action and transaction all remain
`false` without direct product-owned evidence.

The current public runtime remains source-drifted as recorded in
`apps/dex/evidence/dex-public-readback-20260831.json`; no deployment action was
performed by this checkpoint.
