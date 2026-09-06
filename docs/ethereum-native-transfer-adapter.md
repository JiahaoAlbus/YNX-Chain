# Ethereum legacy envelope adapter for native YNXT transfers

This opt-in testnet/devnet adapter supports ordinary **whole-YNXT native transfers** from Ethereum wallets. It is not a full EVM, an EIP-1559 fee market, or a change to the native integer ledger. Mainnet activation is rejected.

`YNX_ETHEREUM_NATIVE_TRANSFERS_ENABLED` (or `-ethereum-native-transfers`) defaults to `false`. `ynx_getFeeModel` exposes the version, exact fee convention and current enabled state even before activation. When disabled, existing native RPC behavior remains available. Activation changes `eth_getBalance` and transaction `value` from legacy native integers to Ethereum wei quantities, so consumers of the old units must migrate before public cutover. REST/native JSON transaction units remain unchanged.

## Exact fee and amount convention

The native ledger charges exactly 1 YNXT for a signed transfer. At 18 decimals, 1 YNXT is `1000000000000000000` wei. The old hardcoded estimate of 21,000 cannot represent this fee as an integer gas price: dividing that fee by 21,000 leaves a remainder of 13,000 wei.

The adapter therefore publishes a **native fixed-fee gas accounting convention** of 25,000 gas at 40,000,000,000,000 wei per gas. Their product is exactly 1 YNXT. This is a declared adapter convention, not measured Ethereum opcode execution.

- `eth_gasPrice`: `0x246139ca8000` (40,000,000,000,000 wei).
- `eth_estimateGas`: `0x61a8` (25,000), after checking supported fields, amount precision, fee policy, recipient, optional sender balance and nonce.
- Accepted signed transactions must use that exact gas price. Gas limits from 25,000 through 30,000,000 are accepted only if the sender can cover the entire signed gas budget plus value. Actual consumption stays 25,000; the ledger debits value plus exactly 1 YNXT.
- `eth_getBalance`, transaction values, receipt effective gas price and fee reporting use arbitrary-precision conversion, never floating-point arithmetic or a change in ledger storage.
- Existing native transaction fees are displayed using the same native fee-to-gas accounting convention. Original transaction hashes, native amounts and provenance events remain in the ledger. Ethereum RPC log blooms are computed from those real native provenance events; they are not evidence of EVM execution.

Native block production does not enforce an EVM block gas scheduler. The adapter projects blocks only while their total fixed-fee equivalent is at most 30,000,000 gas (1,200 transfers charging 1 YNXT each). Beyond that boundary, `eth_getBlockByNumber` and `eth_getBlockByHash` return `-32004` with `native_block_projection_unsupported`, the public block identity, exact fee-equivalent gas and native `/blocks/{height}` path. They do not increase the declared limit, truncate fees or rewrite native history. Receipts retain their exact cumulative fee accounting. Standard wallets or Ethereum-only explorers may therefore be unable to load such a block; native block queries remain complete. This is a bounded compatibility response, not complete Ethereum block compatibility or general EVM execution.

Only positive whole-YNXT amounts up to `MaxInt64 - 1` are supported. Fractional values, zero-value transfers, self-transfers, contract creation, calldata, transfers to known contracts, access-list/typed transactions and nonmatching prices are rejected before state mutation. Raising gas price does not silently change or bypass the native charge.

## Signature and nonce domain

The adapter accepts canonical, bounded, flat legacy RLP with EIP-155 replay protection for the configured chain. It recovers secp256k1 signatures using Keccak-256, enforces low-S scalars, and returns the Keccak hash of the original raw envelope. Ethereum nonce `n` maps to the existing native next nonce `n+1`; stored native nonce rules are unchanged.

Ethereum signatures never masquerade as the existing `YNX_NATIVE_TX_V1` JSON/DER/SHA-256 signatures. The API verifies raw data and the native state-admission method independently reverifies the original raw envelope against hash, sender, recipient, amount, fee and nonce before appending to pending state. The existing native JSON broadcast protocol continues to work separately.

## Persistence and rollback

The original signed RLP is persisted as hex with the versioned prefix `YNX_ETHEREUM_LEGACY_V1:` in the existing authenticated transaction `memo`. This deliberately introduces no new JSON fields into version-2 snapshot integrity encoding. Snapshot loading and replication validate signatures and normalized fields again, even with admission disabled. Historical hashes, native state and old signatures are not rewritten.

An old be9f binary has been tested loading the same new synthetic snapshot and retaining the raw memo, transaction hash, native balance and nonce. A rollback disables Ethereum admission and restores the previous binary **using current durable state**. Restoring a pre-cutover snapshot would lose subsequent legitimate transactions and is not the rollback procedure.

Mined receipt confirmation additionally requires the independent [local transaction durability v1 contract](transaction-durability-v1.md). In-memory inclusion, an old status-1 receipt and a successful same-raw replay hash do not establish durable mined inclusion.

## RPC and release boundaries

Blocks intentionally omit `baseFeePerGas`. `eth_feeHistory` and `eth_maxPriorityFeePerGas` explicitly return `-32004` because EIP-1559 is unsupported. `eth_sendTransaction` cannot use node-held keys and is rejected; wallets sign locally and call `eth_sendRawTransaction`. Non-contract addresses return `0x` for `eth_getCode`; existing native contract artifacts without a bytecode API return an explicit unsupported error.

The inherited authoritative ledger materializes pending native effects immediately. `latest` and `pending` therefore both expose its current authoritative state, not separate historical EVM state views. Historical native aliases/transactions and synthetic block roots are not upgraded into full Ethereum execution proofs by this adapter. The BFT gateway/ABCI path is a separate, unchanged runtime; this implementation targets `ynx-chaind -> internal/api -> chain.Devnet` only.

Before public activation, the coordinator must verify all actual node roles against the candidate source/binary, current common block hashes, authenticated follower freshness, malformed raw rejection, native/Ethereum replay and cold-start tests on each host. A validator list, HTTP 200 or successful local test is not evidence of a four-validator BFT network. Wallet and all consumers of the old `/evm` units must switch together. Real MetaMask installed/browser approval, signing and public send remain separate acceptance gates.

## Verification

`go test -race ./internal/ethnative ./internal/api ./internal/chain ./internal/consensus ./internal/mutationfreeze ./cmd/ynx-chaind`

Independent ethers integration (synthetic keys and loopback HTTP only):

```sh
YNX_ETHERS_MODULE=/absolute/path/to/ethers go test ./internal/api -run TestEthereumIndependentEthersLifecycle -v -count=1
go test ./internal/ethnative -run '^$' -fuzz FuzzDecodeNeverPanics -fuzztime=10s -parallel=2
```

Fixtures include independent ethers 6.17 signatures and the official EIP-155 example. Existing consensus IDE tests also require their ignored compiled Solidity fixtures; fixture provenance is recorded in the audit package.

Standards: [Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/), [EIP-155](https://eips.ethereum.org/EIPS/eip-155), [RLP encoding](https://ethereum.org/developers/docs/data-structures-and-encoding/rlp/), [Execution API fee market definitions](https://github.com/ethereum/execution-apis/blob/main/src/eth/fee_market.yaml).
