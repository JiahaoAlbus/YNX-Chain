# YNX Docs

YNX Docs is an independent document product backed by the product-isolated Docs surface of the shared Cloud object service. The current candidate is integrated in source; it is not yet claimed as the code running on the historical public preview.

## What a user can do

- Sign in through the exact YNX Wallet Web or Mobile registration. Product Sessions are short-lived and memory-only; no recovery key or document plaintext is sent to Wallet.
- Create folders and documents, navigate folders, rename, duplicate and move documents.
- Edit with optimistic versioned autosave. Offline drafts remain on the device. A stale base version opens side-by-side recovery instead of overwriting a newer server version.
- Inspect immutable history and restore any prior version as a new current version.
- Start a version-bound or selected-text comment thread, reply, resolve and reopen it.
- See bounded collaborator presence. This is activity awareness, not a claim of character-level CRDT coediting.
- Grant viewer/editor access to an exact `ynx1` account, create a seven-day viewer link, list active access and revoke either form immediately.
- Move documents to Trash and restore them. Operator retention and permanent erasure remain separate audited controls.
- Export the exact selected version as plain text, Markdown, escaped HTML or a JSON evidence envelope. Every server export returns source, export and version evidence headers. PDF is not implemented or advertised.
- Send only the selected document version to the configured AI provider after explicit consent. Output is a review draft until the user applies or rejects it.

## Storage and chain boundary

Document bytes, versions and folder state live in the Docs/Cloud object store. The chain may carry identity, authorization, payment or content-hash evidence; it does not store document plaintext. Cloud sessions cannot list, read, edit, export, share or use Docs objects as AI context, and Docs sessions cannot cross into Cloud objects.

## Platform identity

| Surface | Product client | Bundle | Callback |
| --- | --- | --- | --- |
| Web | `ynx-docs-web-v1` | `web.ynx.docs` | `https://web4.ynxweb4.com/docs-app/auth/callback` |
| Android/iOS | `ynx-docs-mobile-v1` | `com.ynxweb4.docs` | `ynxdocs://wallet-auth/callback` |

Both use `ynx_6423-1`, P-256 sender-constrained Product Sessions and the sorted scopes `ai.use`, `audit.read`, `comments.write`, `data.delete`, `documents.read`, `documents.write`, `sharing.manage`.

## Verification

```bash
npm --prefix apps/docs test
npm --prefix apps/docs run check
corepack pnpm --dir apps/docs/mobile test
corepack pnpm --dir apps/docs/mobile run typecheck
corepack pnpm --dir apps/docs/mobile run i18n-check
corepack pnpm --dir apps/docs/mobile run bundle
go test ./internal/cloud
go test -race ./internal/cloud
npm --prefix packages/wallet-auth test
npm --prefix apps/wallet test
npm --prefix apps/wallet run typecheck
```

The retained APK is a historical debug-signed Testnet Preview. It is not a current-source build, production-signed package, store release or verified website download.
