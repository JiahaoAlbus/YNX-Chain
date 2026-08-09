# YNX Docs

YNX Docs is a separate document editor served internally at `/docs/` and publicly at
`https://web4.ynxweb4.com/docs-app/`. It uses the shared
Cloud object service but has its own Wallet client binding and scopes. Autosave is
optimistic-versioned, offline drafts remain on the current device, and a stale
draft opens explicit conflict recovery instead of overwriting the server version.

Comments bind to an exact version, collaboration presence expires after 45
seconds, exports are local plain text, and AI can receive only the selected
document version after explicit consent. An AI result must be applied or rejected;
it never overwrites a document automatically.

The public Testnet preview uses same-origin API routing under `/docs-app/api/v1`.
Central Wallet verification is currently unavailable in the public environment,
so private document workflows fail closed instead of creating a local session.

Checks:

```bash
npm --prefix apps/docs test
npm --prefix apps/docs run check
```
