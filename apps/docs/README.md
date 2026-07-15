# YNX Docs

YNX Docs is a separate document editor served at `/docs/`. It uses the shared
Cloud object service but has its own Wallet client binding and scopes. Autosave is
optimistic-versioned, offline drafts remain on the current device, and a stale
draft opens explicit conflict recovery instead of overwriting the server version.

Comments bind to an exact version, collaboration presence expires after 45
seconds, exports are local plain text, and AI can receive only the selected
document version after explicit consent. An AI result must be applied or rejected;
it never overwrites a document automatically.

Checks:

```bash
npm --prefix apps/docs test
npm --prefix apps/docs run check
```
