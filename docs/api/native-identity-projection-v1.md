# Native identity projection v1

Ethereum transaction and receipt `from`/`to` fields and full-block transaction objects use canonical 20-byte addresses. Real 0x accounts and checksummed YNX aliases normalize through the existing accountaddress mapping, preserving their 20-byte payload. An empty `to` remains null.

Legacy native system identifiers (for example `ynx_faucet`) have no Ethereum key. Their display address is the last 20 bytes of SHA256 over the exact UTF-8 bytes `YNX_NATIVE_IDENTITY_PROJECTION_V1`, one NUL byte, and the exact stored native identifier. This network-independent v1 display mapping is source-bound and deterministic; it does not create an account, signature, signer, deposit destination, or balance alias. Do not send funds to a projected system address or infer ownership from it.

The original identities remain in `ynxNativeTransaction.from` and `.to`, alongside type/whole-YNXT amount/fee and native nonce. The nested `identityProjection` declares version, domain, scheme, which identities are systems, and `systemAddressesAreDisplayOnly=true`. No persisted ledger identifier, transaction hash, account, or balance changes. Native APIs retain their original representation.

A native transaction still has `ynxTransactionEncoding=ynx-native`; this projection does not invent an Ethereum signature. Ethereum-signed transfers retain their verified EIP-155 fields. General EVM execution and consensus finality remain unsupported by this bounded adapter.
