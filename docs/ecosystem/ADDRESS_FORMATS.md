# YNX Account Address Formats

YNX Chain accounts are identified by one canonical 20-byte value with two reversible text representations:

- `0x...`: lowercase 40-hex-character canonical EVM form used in consensus state, transaction signing, EVM JSON-RPC, Solidity, ABI encoding, MetaMask, and other EVM tooling.
- `ynx1...`: checksummed Bech32 human-readable alias with HRP `ynx`, used by YNX-native application, SDK, CLI, and Explorer surfaces.

Converting between these forms does not create a second account, change a private key, move assets, or place the account on Ethereum. Both strings identify the same 20 account bytes on YNX Chain. YNX is an L1 because it has its own chain ID, state, consensus path, and network; the EVM address representation is a compatibility contract.

The codec uses the original Bech32 checksum constant and requires exactly 20 decoded payload bytes. Decoders reject the wrong HRP, mixed case, invalid characters, bad checksums, invalid padding, malformed hex, and the wrong payload length. All-uppercase Bech32 input is accepted and normalized to lowercase output.

Native signed-transfer input may use either form, but the CLI converts the recipient to canonical lowercase `0x...` before constructing the sign document. REST account, Faucet, transfer, stake, resource, and Trust-trace entry points perform the same boundary normalization. Existing named local-devnet accounts remain supported and are not misrepresented as production wallet addresses.

The JavaScript SDK exports `toYNXAddress`, `toEVMAddress`, and `normalizeYNXAddress`. The Python SDK exports `to_ynx_address`, `to_evm_address`, and `normalize_ynx_address`. Go, JavaScript, and Python verify the shared fixtures in `testdata/address-vectors.json`.

Explorer account search accepts either form. A canonical account response includes `addressFormats.evmAddress` and `addressFormats.ynxAddress`. MetaMask continues to receive and use the `0x...` form; this repository does not claim wallet-default support for `ynx1...`.

Run `make address-codec-check` for the local cross-language, REST, CLI, consensus, and Explorer verification gate. This implementation is not remote public proof until an exact release containing it is deployed and verified on public endpoints.
