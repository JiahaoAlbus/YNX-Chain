# Merchant Console dependency acceptance

Date: 2026-07-27  
Contract: `ynx.integration.merchant-console.v1`  
Status: **local adapter acceptance only; central acceptance pending**

## Acceptance policy

A dependency is accepted only when its owner supplies a versioned contract, health/version evidence, exact test vectors, migration policy and a reachable test environment. File presence, HTTP 200, mock provider output, sandbox claims or local adapters do not establish central integration.

## Current dependency ledger

| Owner | Dependency | Local adapter | Contract accepted | Remote tested | Fail-closed behavior |
|---|---|---:|---:|---:|---|
| 02 Wallet/Auth | product registry, device challenge, approval, completion, introspection, expiry, revoke | yes | no | no | no fallback login or widened scope |
| 04 Pay | invoice, settlement, receipt, refund execution | yes | partial local code | no | no paid state without exact evidence |
| 08 Quant | strategy identity, realized net PnL, high-water mark | no signed ingestion | no | no | fee remains unavailable |
| 13 Monitor | metrics, alerts, incidents, status | process-local metrics | no | no | monitor endpoint requires dedicated authority |
| 14 AI | context consent, provider/model/cost, audit | bounded local provider interface | no | no | unavailable/rejected provider is surfaced |
| 15 Trust | dispute evidence, status, appeal | reference record only | no | no | no Trust decision claim |
| 17 Economics | fee/burn/treasury/reserve facts | disclosure model only | no | no | unknown values remain unavailable |
| 21 Bridge | cross-chain settlement | no | no | no | explicitly unavailable |
| 26 Data Fabric | canonical events and Billing Ledger | local audit log only | no | no | no central ledger claim |
| 28 Website | microsite/download/SEO/public policy routes | metadata prepared | no | no | no public URL or hosted artifact claim |
| 29 Integration | unique protocol freeze/shared Testnet | handoff prepared | no | no | product remains Active |
| 30 Security/SRE | provenance, hosting, backup, incident/release gates | local partial | no | no | unsigned/local classifications retained |

## Required acceptance evidence

Each central owner must provide:

1. owner and version;
2. source commit and release identifier;
3. schema, events and error codes;
4. auth scopes and signed-intent binding;
5. health/version endpoint with dependency truth;
6. negative vectors for replay, tamper, expiry, revoke and wrong product/device;
7. migration and rollback behavior;
8. reachable shared-Testnet endpoint or explicit external blocker;
9. direct evidence IDs suitable for Explorer/Monitor/Trust;
10. deprecation and incident contacts.

## Current blockers

- Canonical Gateway registration/endpoint is not accepted remotely.
- Shared Testnet deployment and funded secure signer path are unavailable in this worktree.
- Quant/Billing Ledger signed fee evidence contract is not accepted.
- Public receiver, deployment authority, DNS and public policy/status URLs are unavailable.
- Three bounded pushes of commit `1f7963c` returned upstream HTTP 502; a verified recovery bundle exists.

These blockers do not justify mock production or alternate central implementations. Merchant work continues on independent adapters, tests, migrations, recovery, UI failure states and evidence.
