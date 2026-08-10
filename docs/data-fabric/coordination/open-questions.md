# Open Questions — YNX Data Fabric

These are dependency-owner acceptance items, not requests for ordinary engineering decisions.

1. **Wallet/Auth owner:** Which versioned central introspection endpoint, trust root and Product Session tuple is accepted for shared Testnet? Recovery condition: execute `DF-XP-006` with replay, wrong product, bundle, device, scope, expiry and revoke receipts.
2. **App Gateway owner:** Which product registration and signed forwarding contract is frozen? Recovery condition: owner acceptance record bound to exact Gateway and Data Fabric commits.
3. **Integration owner:** Is Envelope v2 plus Schema Registry v2 the unique frozen cross-product protocol? Recovery condition: conflict review and protocol-freeze receipt; no long-term dual competing contract.
4. **Pay and Chain Core owners:** Which shared-Testnet endpoints and source releases are accepted for `DF-XP-014`? Recovery condition: one durable invoice, settlement, receipt, refund and reconciliation evidence bundle.
5. **Exchange, DEX and Quant owners:** Which authoritative event, fee and reconciliation contracts are accepted? Recovery condition: registered v2 schemas and positive, duplicate, out-of-order, tamper, compensation and fee vectors.
6. **Security/SRE owner:** Which production-shaped PostgreSQL, JetStream, backup, alert, secure signer and immutable uploader classes are approved? Recovery condition: direct failure-drill, restore, signing and hosted back-read receipts.
7. **Website owner:** Which canonical, support, privacy, security and status URLs are approved? Recovery condition: consume public metadata without changing runtime or download states before direct public evidence exists.

No secret, private key, seed, PEM, provider credential, database password or signer material should be placed in this file or chat.
