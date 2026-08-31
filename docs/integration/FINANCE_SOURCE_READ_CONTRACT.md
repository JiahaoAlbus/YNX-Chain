# Finance cross-product read envelope

## Status

`finance-source-read-envelope-v1` remains the Finance-owned common envelope. Finance now accepts the frozen Exchange, DEX and Quant owner contracts. The DEX contract is `dex-finance-read-v1`, its payload schema is `ynx-dex-finance-account-v1`, and its canonical artifact is `release/integration/dex-finance-read-contract.json`.

When an owner and Finance receive the matching secret-managed integration key and Finance has a reviewed endpoint, `/api/portfolio` and `/api/sources` load only the Wallet-authorized account's persisted owner evidence. Without runtime configuration, an accepted owner reports `ownerContractAccepted: true`, `available: false`, and `syncStatus: integration-unconfigured`.

Economics still reports `ownerContractAccepted: false`, `available: false`, and `syncStatus: owner-contract-pending`. No missing balance, position, PnL, APY, supply, price, fee, fiat value or impermanent-loss value is inferred. Local candidate verification is not public-deployment evidence until the exact source-bound release is installed and independently probed.

## Envelope boundary

The common envelope binds an immutable owner payload to:

- the exact source and authoritative owner;
- `ynx_6423-1` and native asset `YNXT`;
- the normalized Wallet-authorized account;
- the frozen owner contract version and payload schema;
- source-owned `asOf`, coverage and sync semantics;
- an explicit list of read-only capabilities.

The envelope does not interpret the owner payload. Exchange owns subaccounts, positions, fills and venue fees. DEX owns vault, LP, swap and exit records. Quant Lab owns strategy, mandate, capital, PnL, risk and fee analytics. Tokenomics owns supply, issuance, burn, reward-source, treasury and reserve evidence.

## Stream boundary

`ynx-finance-stream-envelope-v1` is the product-adapter WebSocket/SSE read
shape. Every message is a source-bound `snapshot`, `upsert`, or `reconciled`
model record with an event ID, request ID, monotonic per-stream sequence,
emission time, and matching source status. `readOnly` is always `true`.

It is deliberately not a Data Fabric canonical event, Wallet callback, order
intent, signer request, or execution receipt. A reconnect must start with a
new snapshot and cursor from the owning source; clients must not infer a missed
write or a successful execution from sequence gaps.

## Owner credentials

Finance never forwards a Wallet Product Session proof after consuming it. Instead it signs an exact `GET /v1/integrations/finance/account` owner request using `YNX_READ_INTEGRATION_V1` HMAC-SHA-256. The credential binds consumer, owner, method, escaped path, normalized account, timestamp and a 128-bit random nonce. Each owner permits 30 seconds of skew and consumes each nonce once. Query strings, wrong paths, wrong accounts, tampering, expiry and replay fail closed.

Every owner pair uses a distinct secret. DEX receives `YNX_DEX_FINANCE_READ_KEY` while Finance receives the same value as `YNX_FINANCE_DEX_READ_KEY`; it is never returned to either client. DEX strips Wallet keys, sessions, authorization material, other-account records and all mutation authority, and emits only raw account-bound indexed evidence.

## Fail-closed rules

Finance rejects the envelope before any payload is exposed when:

- the owner contract is not explicitly accepted;
- source, owner, network, asset or authorized account differs;
- envelope, owner contract or payload schema version differs;
- unknown fields, duplicate capabilities, empty payload or incomplete provenance appear;
- `asOf` is materially in the future;
- any capability is not on the accepted allowlist;
- a capability contains explicit write, sign, execute, mutate, change, manage, control, place, submit, cancel, pause, resume, revoke, approve, create, update, delete, settle or rotate semantics.

Read capabilities may describe trades, swaps, withdrawals, transfers, leverage or Treasury evidence. They cannot grant the corresponding action. A capability whose name merely ends with `.read` does not bypass the mutation-token check.

## Action boundary

Finance action links are navigation only. They must be absolute HTTPS URLs without embedded credentials, are omitted by default, and open the owner product. Finance never receives a signer, withdrawal credential, order API, vault owner right, Quant deployment method or Treasury mutation capability.

Sensitive actions remain in their owner flows:

- Exchange order or withdrawal review in YNX Exchange;
- vault exit, swap or emergency exit in YNX DEX and Wallet;
- strategy pause, mandate change or kill switch in Quant Lab and Wallet;
- issuance, burn, reward or Treasury control in the authoritative protocol/governance flow.

## Acceptance sequence

1. The owner publishes a versioned read-only payload contract and negative vectors.
2. Integration freezes owner, version, payload schema, account binding, events and errors.
3. Security reviews credentials, scopes, rate limits, retention and outage behavior.
4. Finance adds an exact `AcceptedReadSourceContract` and a source-specific payload adapter.
5. Wrong owner/account/network/asset/version/capability and outage tests pass.
6. Shared Testnet evidence proves the owner payload and Finance display refer to the same account and source commit.

No source may move from pending to available based only on an environment variable, test harness or generic JSON response. Availability requires the exact frozen owner contract, authenticated account-bound response, strict envelope validation and a matching runtime endpoint. Exchange, DEX and Quant adapters pass their local implementation and test gates; each still requires source-bound shared-Testnet runtime evidence before a public-live claim.
