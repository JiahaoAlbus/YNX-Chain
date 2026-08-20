# Card P0 Wallet Contract Consumption Evidence

Card consumes the following immutable owner-independent inputs without changing
Wallet Protocol, the DApp SDK, Gateway, or central control-plane:

| Input | Exact checkpoint | Card consumption |
| --- | --- | --- |
| Wallet Protocol public/runtime checkpoint | `d003a71b7658bbe530c5a9f646e6d3e908e22287` | Reference only; it does not prove Card runtime consumption. |
| Standard Wallet contract | `66003e76e804da16d472255efde50cb879055b96` | SDK constant reference and Card runtime behavior use `p0-wallet-connection-v1`, `0x1917`, and standard `0x…` accounts. |
| Developer DApp SDK | `315897e75c0ffe3e63435fe73cfec42244b851cc` | Immutable vendor tarball `vendor/ynx-dapp-connect-sdk-0.1.0-p0.0-315897e7.tgz`, SHA-256 `4a3c47f017a6932015686f20adfd29990a8c317ffdbb3f6fc5c4c9f16be5bc53`. |
| Canonical Wallet error contract | `24cc3218c2cdc00c50dc3caa563652083afbd861` | Immutable vendor tarball `vendor/ynx-chain-wallet-auth-1.0.0-24cc3218.tgz`, SHA-256 `d94eda02e7e76bde6a56159a50fe515fe310b3e17baa6674dbdd00b2b252f4dd`. |

## 1. Card runtime evidence

`src/wallet.ts` instantiates SDK `StandardWalletConnection` for
`eth_requestAccounts` and YNX Testnet verification before Card starts a private
session. It uses SDK `enhanceWithProductSession` only after standard connection.
The executable `src/wallet.test.ts` vector establishes a `0x1917` standard
connection, then simulates a `503` private completion. The resulting state is
`PRIVATE_SERVICE_DEGRADED` with correlation IDs while the original Card wallet
session remains `CONNECTED` with its `0x…` account and chain.

This is Card unit/runtime evidence, not a public device proof or a Card
Gateway-completion claim.

## Canonical Wallet error contract

Card calls `walletErrorResponse` from the exact `24cc3218` Wallet/Auth package
to obtain bounded safe error fields. It maps explicit SDK compatibility states
to canonical Wallet codes, preserves all EIP-1193 identities `4001`, `4100`,
`4200`, `4900`, `4901`, and `4902`, and maps no unknown code to a Gateway or
Offline state. Unknown or malformed codes fail closed as
`UNKNOWN_WALLET_ERROR`; the Card UI never receives `developerMessage`.

The Card runtime test covers provider identity, device-proof-safe output,
correlation IDs, an unavailable private Gateway while standard Wallet remains
connected, and malformed/unknown error failure. This consumes the source-only
contract locally; it does not change the observed `6cf` public runtime truth,
deployment state, or Product Session migration claim.

## 2. v2 Gateway evidence

Card remains `registry-ready/contract-only`; `migrated-v2=false`. The public
Wallet Auth source checkpoint `6cf3ef84` and lifecycle availability are not
treated as Card consumption proof. This Card branch has no accepted Card
registry entry, no Card v2 Gateway completion receipt, no canonical Card
Product Session, and no Card API response carrying v2 correlation IDs.

The Card adapter preserves any `x-request-id`, `x-trace-id`, and `x-error-id`
received from a future Gateway response. Until a real Card completion exists,
this section is `NOT_EVIDENCED`.

### Accepted endpoint consumer boundary

Card bundles the accepted `public-endpoint-manifest@1.0.0-p0.2` source snapshot
from `bfd850a2c7bd238e3febc7267ff31be17890888d` and accepts only its fixed
`https://gateway.ynxweb4.com` origin when the manifest marks `appGateway` as
`VERIFIED` or `DEGRADED`. No Card caller or environment variable can supply a
Gateway host, credentials, path, or query. The currently bundled manifest marks
`appGateway` as `UNAVAILABLE`; Card therefore fails closed before any private
session request and reports private-service degradation while Standard Wallet
remains connected. `/app/card/session/*` is an existing legacy private route,
not Card v2 evidence.

## 3. Visible platform evidence

`App.tsx` renders `Standard wallet CONNECTED` independently from the private
Card service state. On private-session failure it renders `Degraded` and the
safe error code/request ID while retaining the connected `0x…` account and
`0x1917` chain. This source behavior has an executable Card runtime vector but
has no fresh device/emulator screenshot with an injected Wallet provider.

Therefore visible-platform status is `SOURCE_AND_UNIT_TEST_ONLY`, not a public
or installed-platform claim.

## Central promotion gate

Do not request Central promotion until all three evidence classes are present:

1. Card runtime: an actual standard-wallet connection and deliberate private
   Gateway degradation showing the connected wallet persists.
2. v2 Gateway: a real Card-owned completion/introspection/revoke lifecycle with
   Card registry proof and correlation IDs.
3. Visible platform: device/emulator evidence of the exact connected/degraded
   UI, plus restart/recovery behavior.
