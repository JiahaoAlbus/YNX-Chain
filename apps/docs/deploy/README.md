# Docs deployment handoff

## Existing Caddy, independent Docs origin

The coordinator selected `https://docs.ynxweb4.com` as the new deployment target
and owns the existing Caddy configuration. Do not create an nginx service. Serve
the complete `apps/docs/web` directory. Map the exact `/wallet-auth/callback`
path to `wallet-auth/callback/index.html` without redirecting the callback URL.
Proxy `/api/v1/*` unchanged to the approved shared local service on port `6496`.
Keep this static callback separate from the Cloud daemon root callback.

The coordinator found that old `/docs-app/*` rewrites to `/docs/*` and forwards
to `6496`, while the old root `/api/v1` reaches a www redirect. Do not copy that
API redirect into the new host. Keep the old route until the coordinator switches
it. Its `app.js` HTML does not bind it to this candidate's `app-secure.js` source.
The retained nginx template is an unused historical alternative, not an instruction
to install or run nginx.

## Static SDK and callback implementation

`vendor/source-manifest.json` identifies the frozen SDK commit
`9840ef871165eb523c4e7a3d48964dd25f8dee8e` and verified SHA-256 values for the
standalone standard module, private browser module and exact registry. Both
bundles include their dependencies; preserve their names and relative paths.

The editor loads `standard-wallet.js`: explicit YNX/MetaMask selection, read-only
restore, provider-event updates, local disconnect and confirmed permission
revocation. This path does not call the private Gateway. It does not establish a
Docs server session or approve an action.

`session.html` and the root callback use `wallet-session-page.js` and
`product-session-client.js`. They call the official SDK constructor, `restore`,
`beginExplicit`, `handleReturn(location.href)` and `disconnect`. Installation
remains unverified; no checkbox or injected provider is treated as proof that a
native URL scheme is installed. The user explicitly prepares the request and
separately chooses the SDK-generated Open Wallet link. Restore never opens
Wallet automatically. A pending or failed revocation is not reported as success.

The callback now contains real SDK completion logic, not a placeholder. Its
static deployment configuration `wallet-session-config.json` now sets
`enabled: true` after the coordinator confirmed the matching 9840 authority and
registry deployment. This enables the Docs session code path, not a claim that a
real user has completed Docs login. `apiReadEnabled` remains independently gated
on actual Cloud backend deployment.
The authority is fixed to `https://wallet-auth.ynxweb4.com`; callback input cannot
supply an authority, SDK URL, registry URL, or legacy session. Both SDK constructors
come from the same private bundle. Its authority-bound device/state namespace does
not read, migrate or delete old records without an authority binding. Old authority
sessions remain separate; new authorization requires explicit approval.

The callback requires same-origin scripts and styles, and connections to self
and `https://wallet-auth.ynxweb4.com`. A suitable response CSP is:

```text
default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://wallet-auth.ynxweb4.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

Send `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and
`X-Content-Type-Options: nosniff`. Exclude callback query parameters and proof
headers from ingress/access logs. After successful SDK completion the page removes
callback parameters using history replacement. Do not strip them before the SDK
has validated and persisted the return.

## Bindings and product API boundary

- Product: `docs`; display name: `YNX Docs`.
- Cross-platform client: `ynx-docs-mobile-v1`.
- Web application: `com.ynxweb4.docs.web`.
- Web callback: `https://docs.ynxweb4.com/wallet-auth/callback`.
- Native application: `com.ynxweb4.docs`.
- Native callback: `ynxdocs://wallet-auth/callback`.
- Initial private-session scope subset: `docs.read`, `files.read`.

The existing editor data flow still uses the old product session API. The v2
session page is a separate, read-only authorization flow. Cloud owns the backend
v2 switch and server-derived route scopes. `product-session-transport.js` is ready
to attach fresh SDK proofs to product requests but is not yet wired to the editor
API. Never silently fall back to legacy Bearer after a v2 failure.

Pass `X-YNX-Product-Session-Proof-V2` unchanged to the backend. Do not consume the
same proof in the browser first. Preserve the agreed business idempotency header
and disable automatic proxy retries. The proposed `Idempotency-Key` still requires
Cloud's exact contract and storage before write retries are enabled. A session
proof does not sign document content or approve sensitive actions.

Remaining runtime dependencies: domain/hosting/TLS confirmation, upgraded active
Wallet authority, Cloud route scopes and write-idempotency semantics, editor API
integration, and real browser/installed Wallet lifecycle acceptance. Local source,
bundle integrity and tests do not establish public login or business completion.

## Create/save follow-up

The current bundled private SDK/registry is now
`a7dad7ec1bc7c06577978bdd5fea8dc9c7a248a9`; see the vendor manifest for hashes.
Cloud fixed write source is `dd04f6109bb4b56ef572171e8081a9ee4b06a7e6`.
The v2 session page now offers a separate editing profile requesting the sorted
subset `docs.read`, `docs.write`, `files.read`, `files.write`. Its creation/save
panel uses POST objects and PUT objects/{id}/document with exact write-route
scopes `docs.write`, `files.write`. The original editor's remaining mutation
features are still on the old flow and have not all been migrated.

Prepared write bodies and idempotency keys are retained locally before submission.
An explicit retry uses the identical request with a fresh proof. Unknown outcomes
and version conflicts preserve the draft and require server readback and review
before a new write. The server's `<StatePath>.v2-idempotency` sidecar must be kept
with state backups and rollback. Do not delete it to resolve a pending request.

`apiWriteEnabled` remains false until the write-capable Gateway registry and Cloud
backend are actually deployed. `apiReadEnabled` remains separately gated. Neither
SDK allowlist additions nor local tests establish successful public writes.

## Main editor core migration

The independent Docs origin now routes the main `app-secure.js` editor through
`editor-session-bridge.js`. It restores the official v2 session, uses paginated
reads, and sends create/save through the fixed fresh-proof/idempotency contract.
It never reads or sends the old Docs bearer credential on that origin. Version
conflicts require fresh content readback and an explicit recovery choice. Pending
uncertain operations remain available for reconciliation on the session page.

Other origins retain their existing legacy code path; this does not migrate old
state or bind the old web4 deployment to the new source. On the independent v2
origin, rename/move/duplicate/trash/export/history/comments/AI/presence are disabled
until their actual backend contracts are implemented. Read-only scopes cannot
edit document text. The core migration is not full feature or runtime acceptance.

## Authority readiness and local export

The coordinator and release_intake have confirmed public a7 Gateway deployment.
`editingAuthorizationEnabled: true` now permits an explicit editing-scope request
independently from backend availability. `apiReadEnabled` and `apiWriteEnabled`
remain false until Cloud's real existing-state deployment is confirmed. An
allowlist is permission to request scopes, not evidence of user approval.

Main-editor export is now available locally for an already authorized, saved
version: text, Markdown, escaped HTML and JSON. It excludes newer unsaved edits,
labels the saved version, and does not call an unsupported backend export route.
Other unimplemented v2 toolbar actions remain disabled.
