# Finance cross-product read envelope

## Status

`finance-source-read-envelope-v1` is a Finance-owned consumer proposal. It is not an Exchange, DEX, Quant or Economics owner contract, and it does not mark any dependency as centrally integrated. Integration must freeze each owner payload schema and version before Finance can add an `AcceptedReadSourceContract` in runtime code.

Until that happens, `/api/portfolio` and `/api/sources` return all four sources with:

- `ownerContractAccepted: false`;
- `available: false`;
- `syncStatus: owner-contract-pending`;
- no balances, positions, PnL, APY, supply or fee figures;
- no owner action URL unless an operator supplies a reviewed HTTPS route.

This pending state is production behavior, not a fixture or placeholder success.

## Envelope boundary

The common envelope binds an immutable owner payload to:

- the exact source and authoritative owner;
- `ynx_6423-1` and native asset `YNXT`;
- the normalized Wallet-authorized account;
- the frozen owner contract version and payload schema;
- source-owned `asOf`, coverage and sync semantics;
- an explicit list of read-only capabilities.

The envelope does not interpret the owner payload. Exchange owns subaccounts, positions, fills and venue fees. DEX owns vault, LP, swap and exit records. Quant Lab owns strategy, mandate, capital, PnL, risk and fee analytics. Tokenomics owns supply, issuance, burn, reward-source, treasury and reserve evidence.

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

No source may move from `owner-contract-pending` to available based on an environment variable, a mock server or a generic JSON response.
