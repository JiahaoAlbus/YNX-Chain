# YNX Quant Lab Decisions

## D-001 — Preserve recovered work before expansion

The recovered branch was ahead of remote and clean. Existing commits were tested,
then pushed before new runtime work. No reset, clean, force push or Dirty Change
discard was used.

## D-002 — Release validation must fail closed

The release gate no longer depends on unavailable `rg`, chooses only a healthy
Python 3.9+ interpreter, and validates archive safety and reproducible artifact
hashes. A skipped scanner or dead interpreter is a failure, not a pass.

## D-003 — Remote venue responses are untrusted

Exchange and DEX transports are owner-supplied narrow capabilities. Quant
completes only fresh terminal receipts fully bound to the reserved intent.
Nonterminal or invalid responses leave a durable unknown outcome and block
repeat submission until reconciliation.

## D-004 — Quant never gains custody or withdrawal authority

Exchange assets remain in the user's subaccount; DEX assets remain in the
user's Strategy Vault. Quant may enforce a Wallet-approved mandate but may not
hold keys, withdraw, change owner, widen risk or undo revoke.

## D-005 — Integration artifacts are proposals until owner acceptance

The contract, events and test vectors describe the Quant-owned boundary and
required owner inputs. They do not claim Wallet, Exchange, DEX, Oracle, Data
Fabric or Integration acceptance. Only 29 Integration may freeze the shared
version.

## D-006 — Evidence state is machine checked

The integration validator compares contract release booleans with
`product-release.json`, checks unique coverage/vector IDs and required fields,
requires all vectors to remain pending, and rejects central/Testnet/public
promotion without direct evidence.
