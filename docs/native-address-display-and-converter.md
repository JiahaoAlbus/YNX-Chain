# Native address display and conversion

YNX applications display the checksummed `ynx1` representation by default. Its corresponding `0x` value identifies the same 20-byte account. The existing Go accountaddress and JavaScript SDK algorithms remain unchanged. EIP-1193/JSON-RPC, stored account keys, signed payloads and transaction hashes retain their wire formats.

`GET /address` provides an offline browser converter in 12 languages. `GET /api/address?address=...` resolves one complete YNX or EVM account to `{ynxAddress, evmAddress}` without calling a node or accessing wallet state. Conversion does not move balances or select a network. Legacy named system accounts such as `ynx_faucet` have no invented Bech32 conversion.

Faucet input validation accepts both formats with YNX checksum/padding validation. An additive `addressFormats` response supports native display while `address` and `transaction.to` remain canonical. Both inputs share the same existing rate-limit identity. The faucet request durability work remains separate and public mutation stays frozen until its coordinated release.

The browser codec is parity-tested against Go and `sdk/js/index.js` with fixed and deterministic vectors. Explorer display converts only known account fields; memo, logs data/topics, raw bytes, hashes and signatures are preserved. Copy uses the displayed value. Transaction queries and source objects are not rewritten.

## Release lineage

This candidate is based on the Core/Faucet branch `90643ffd38d970f526df99e96e818220330710f8`. Its Explorer baseline is older than the current Explorer release `8fd22e541073c72c86ff5fc5e8d5f0a76b361442`. **Do not deploy its Explorer binary.** Port the bounded address/brand changes onto the current Explorer branch and revalidate all current search, contract, historical, pagination and 12-language behavior before publication. Local browser screenshots from this candidate are address-tool evidence, not proof of a production-compatible Explorer bundle.
