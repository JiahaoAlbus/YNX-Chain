# YNX Video open questions and dependency requests

These are owner-bound integration questions, not requests for ordinary user decisions.

1. **YNX 02 Wallet/Auth** — Accept or reject the exact Video mobile/web and Creator Studio registrations, bundle IDs, callbacks, scopes and Gateway v2 attestation tuple in the final integration contract.
2. **YNX 04 Pay** — Provide the accepted testnet tip/settlement receipt and payout-intent contract, including creator split, fee facts and replay semantics.
3. **YNX 15 Trust** — Provide a delegated per-user appeal submission contract. Video will not impersonate the creator with a service signer.
4. **YNX 26 Data Fabric** — Freeze canonical Video usage, moderation and billing event ownership/versioning.
5. **YNX 29 Integration** — Resolve any conflicting scope/event/error definitions and schedule shared testnet vectors.
6. **YNX 30 Security/SRE** — Repair the shared placeholder/secret gates so missing `rg` fails closed; provide artifact/release acceptance and public deployment boundary.
7. **YNX 28 Website** — Consume the Video public metadata package after Integration/SRE freeze; website publication must remain separate from runtime deployment.
8. **Local operator environment** — Restore a valid ClamAV daemon configuration and signature database without committing machine-local configuration or signatures.

No private key, seed, PEM, validator key, payment card data or full provider secret is requested in chat or committed to the repository.
