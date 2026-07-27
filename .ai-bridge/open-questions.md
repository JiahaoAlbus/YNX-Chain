# YNX Seller Console Open Questions

These are integration questions, not requests for secrets in chat.

1. Has Owner 02 deployed and accepted the `ynx-seller-v1` registry tuple, including ordered scopes and session introspection semantics?
2. Will Owner 02 accept `POST /v1/product-authorizations/revocations` with `seller_store` resource binding and the exact request/receipt fields frozen in `seller-console-contract.json`?
3. Has Owner 04 frozen the authoritative settlement and refund evidence schema used by Seller Console?
4. Has Owner 15 frozen the Trust dispute and appeal reference schema?
5. Will Owner 26 accept and idempotently ingest the versioned Seller role-update, invitation and revocation Outbox events while retaining canonical event ownership?
6. What current-source staging and immutable artifact paths will Owners 28/30 accept for Seller Console?
7. Which tax, carrier, address, storage and email providers have approved Sandbox or Testnet credentials and permitted retention terms?
8. Which exact shared-Testnet actor accounts and store resources will Owner 29 use for the invite/accept/update/revoke vectors?

Until answered with direct owner evidence, affected coverage entries remain pending or blocked; they are not marked complete.
