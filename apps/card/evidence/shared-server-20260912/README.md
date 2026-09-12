# Shared Wallet server consumption and storage recovery

The Card service entry now calls the fixed Wallet-owner a7dad7ec server authorizer for fresh Product Session introspection. Product/platform/scopes/tuple/expiry validation remains in the shared SDK; the HTTP router rejects duplicate security headers and enforces exact route scopes. A private Session is not a Card business approval. The business verifier is separately consumed from the same bundle.

Local attempt 01 passed 46 backend tests and typecheck. Expanded attempt 02 failed due to test HTTP requests lacking Host and test JSON response types being unknown; both failed logs are retained. Attempt 03 passed 66 backend tests and combined application/server typecheck after those test-only fixes.

The two Wallet-owner public fixtures are explicitly synthetic, with fixed historical authority time and no secret. Mock authority transport exercises consumer response validation and replay-error propagation, not live cryptographic authority or public Wallet approval. The actual local HTTP/SQLite test proves a scoped fixture can create DRAFT, while a Session proof used as a business approval is rejected and persists DEGRADED without creating a card or credit.

Storage migration/backup evidence is separately recorded under `../storage-recovery-20260912`. The six storage tests also ran successfully using the actual VPS Node22.23.1 in an isolated private temporary directory. No service was installed and no public route, alias, account request, signature or transaction was performed.

Pending: source-bound VPS complete candidate runtime, actual authenticated/native UI flow, accepted Web same-origin read semantics, controlled Card Testnet funding recipient, service installation and public Caddy routing by coordinator, real Wallet business approval and receipt, real YNXT transaction/ledger credit, Data Fabric delivery, new platform builds/installation and public/browser lifecycle evidence. All real session/approval/funding/payment/public-deployed flags remain false for this slice.
