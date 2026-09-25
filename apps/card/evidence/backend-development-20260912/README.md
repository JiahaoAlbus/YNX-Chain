# Card durable business backend development

This checkpoint adds the Card-owned service under `apps/card/server`. It does
not replace the guest simulation, native APK, shared Wallet protocol, Gateway,
or public deployment. The environment is exclusively
`YNX_TESTNET_CARD_PAYMENT_SIMULATION`; real-world payments remain false.

## Implemented in this source

- SQLite WAL transactions with AES-256-GCM owner-bound encrypted snapshots and
  a separately configured storage key. Public owner/transaction claim metadata
  is not described as encrypted. Database file mode is restricted to 0600.
- Wallet-bound application states, explicit terms and five-field details,
  separate approval-verifier seam, durable idempotency and owner isolation.
- Missing business approval leaves no card and persists DEGRADED. Login alone
  never supplies an application approval. Native YNX subjects can register;
  EVM funding sender authorization is not inferred from an address conversion.
- Exact route scopes, with authentication repeated before cached outcomes.
  Legacy coarse Card permissions, bearer headers and legacy proof headers do
  not grant access. Unknown routes do not consume a Wallet proof.
- Exact native Testnet wei funding intents; server-only receipt, transaction,
  chain, canonical block, confirmation and intent-binding verification.
  Globally unique transaction claims commit atomically with funding credit.
- Available, Pending, Posted and Fee ledgers; simulated authorization, partial
  capture/reversal/refund, fee posting, controls and persisted audit/outbox.
- Read-only local reconciliation of per-entry snapshots, conservation,
  authorization holds, captures, funding credits and stored receipt bindings.
  Local consistency does not claim live chain or Data Fabric reconciliation.

## Executed development evidence

`attempt-04/results.json` binds raw log digests for 32 passing backend tests and
passing combined client/server typecheck. The tests include real local HTTP and
SQLite restart boundaries, but Wallet approval and Core chain responses are
fixtures. Earlier failed attempts remain recorded; they are not overwritten or
represented as passing. The preceding Card standard SDK checkpoint has its own
28-test and local Web-build evidence in `../standard-sdk-c97f85e9`.

## Unfinished integration, not completion evidence

- The accepted Wallet server verifier and native review/sign/return must still
  be consumed at their exact delivered source. `WalletAuthority` is an explicit
  dependency; the default implementation returns 503, not a successful login.
- The requested `card:topup:write` and `card:simulation:write` scopes still need
  the Wallet Owner's new fixed registry. No current session is silently upgraded.
- The Card application approval contract and MetaMask-compatible signing path
  need separate direct proof. A native signature helper is not MetaMask E2E.
- The business backend is not yet wired to the native/Web registration UI or a
  public HTTPS service. Persistent hosting, deployment, operational backup and
  restore, exact public source identity, installed behavior and full E2E remain.
- Data Fabric publication and cross-service reconciliation are not evidenced.
- Real account approval/rejection, real YNXT funding, ACTIVE card issuance in a
  real account, Product Session migration, real payments and Computer Control
  remain unproven/false. No real PAN/CVV, fiat or card-network capability exists.

The original 22e5 native build and its device-installation ownership are unchanged.
Problems and external dependencies are reported to the continuation ecosystem
audit coordinator, not the superseded audit task.
