# Custody And Deposit Withdrawal Guide

YNX accounts use secp256k1 ownership and one canonical 20-byte account with two representations: lowercase EVM `0x...` for storage/signing/EVM RPC and checksummed `ynx1...` for native display and REST lookup. They are aliases, not separate wallets. Memo/tag is not used.

The readiness package never generates or reads production custody keys. Its deterministic vectors use test-only keys, include public key/signature material, set `privateKeyMaterialIncluded=false`, and are marked unsafe for production custody. Production hot/warm/cold roles, quorum, recovery, rotation, withdrawal approval, nonce allocation, signer isolation, audit retention, and owner handover require an external ceremony and provider review.

Do not fund package fixture addresses for production use. Do not enable deposits or withdrawals from local proof alone. Production activation requires exact public release verification, custody receipt, approved confirmation/reorg rules, tested pause/rollback controls, and an independently executed deposit/withdrawal test.
