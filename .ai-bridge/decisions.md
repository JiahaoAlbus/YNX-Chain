# YNX Browser decisions

Updated: 2026-07-27

1. **Private downloaded files may remain, but Browser metadata must not.** The operating system owns the user-selected file. YNX Private mode guarantees no normal YNX Downloads record, not impossible file erasure.
2. **Download attribution is captured at initiation.** Completion must never consult whichever tab is currently active.
3. **State migration is sanitizing and versioned.** v1→v2 strips persisted Private/ephemeral records, writes atomically, and keeps a v1 rollback backup.
4. **Unknown future state fails closed.** It is not silently coerced into the current schema.
5. **Tab ID and Private classification are immutable through generic patches.** Only URL, title, crash and group fields are mutable.
6. **Audit export is opt-in.** General Browser export excludes audit records unless explicitly selected.
7. **Windows device identity uses CNG ECDSA P-256 with no private export.** No PEM, raw private key or app-managed key file is created.
8. **Windows pending Wallet state is signed locally.** Nonce, expiry, chain, client, bundle, callback and ordered scopes are covered before persistence.
9. **Browser never creates an authoritative Product Session.** Local callback checks are preliminary; Gateway signature/device challenge and Wallet/Auth authority remain mandatory.
10. **Source gates are not binary evidence.** macOS and Windows release states stay unverified until their native builds, installs and interaction drills run.
11. **Local audit names are noncanonical.** Product 26 owns canonical event definitions; product 29 freezes the integration version.
12. **No dual registry.** The existing v2 registry candidate remains the one local tuple source until Wallet/Auth accepts it or provides an explicit migration.
