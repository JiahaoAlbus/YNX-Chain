# YNX Docs Open Questions

These are engineering questions with named owners, not requests for the user to make routine implementation decisions.

1. **Collaboration freeze — YNX 35 / YNX 29**  
   Which protocol wins the measured CRDT/OT/server-serialized/offline-merge bake-off, and what migration format is frozen?

2. **Wallet tuple acceptance — YNX 02**  
   Accept or reject product `docs`, client/bundle `com.ynx.docs.web`, callback `/docs/auth/callback`, chain `ynx_6423-1` and the proposed Docs scopes.

3. **Cloud object contract — YNX 20**  
   Freeze object reference, hash, owner/ACL, retention, delete, version and restore semantics for Docs bodies, attachments and exports.

4. **AI Gateway contract — YNX 14**  
   Confirm provider/model/cost/status fields, bounded selected-version payload, cancellation and audit semantics.

5. **Trust evidence contract — YNX 15**  
   Accept `actor`, `action`, `objectId`, `hash`, timestamp and details schema; provide Testnet report/appeal receipt semantics.

6. **Data Fabric events — YNX 26**  
   Confirm canonical event names and billing fields without moving document plaintext into the ledger.

7. **Release policy — YNX 30**  
   Provide accepted artifact signing class, SBOM/provenance format, backup policy and public deployment gate.

8. **Website consumption — YNX 28 via YNX 29**  
   Consume `/docs` metadata only after central freeze; keep `websitePublished` distinct from `deployedPublic`.

9. **Central full-test failures — respective owners**  
   Repair key-permission failures in consensus/faucet/Trust and restore missing Devtools contract artifacts before the final repository-wide preflight.
