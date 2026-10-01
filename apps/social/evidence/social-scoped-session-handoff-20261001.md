# Social scoped-session source handoff

Status: SOURCE_CANDIDATE_ONLY. Public/installed end-to-end acceptance is NOT_VERIFIED.
Central build/release owner A alone may generate bundles, binaries, installers or deployments.
No deployment, installed-client operation, user-browser operation, account approval,
personal_sign, typed-data signature, transaction or private-key collection was performed.

## Source ancestry and writer boundary

- Base: c6aafd7fa866c299926c787bce5d3b486df60e2e.
- Base tree: a77760b1115f5121640fd28ec8958b9a2ed49fd0.
- Branch: codex/social-sso-chat-20261002.
- Social-owned backend/native inheritance: dcbbaf047a2fca8c5446661b44d9eda7876b1b10.
- Social-owned Web inheritance: 1b8b2abfa4c815a257ca0be4cfd89462a928b96f.
- Original worktrees were not modified; no pull/rebase/reset/force push.
- Shared changes are only the approved exact Social browser registration,
  Go fixed-origin allowlist and their tests. Finance/Exchange/Quant registrations
  and identity-only grants remain unchanged.
- This handoff and the sibling SHA256 inventory are committed with the source;
  exact commit/tree/parent and remote identity are provided in the Central message.

## Implemented boundary

- Legacy Login retains only actual approved private scopes, not all allowed scopes.
  Legacy identity defaults remain account:read/profile:link and grant no messaging.
- Requests accept only sorted, unique scopes from the exact registered Social
  policy. social.ai/social.feed/wildcards are not added to the registry.
- Shared Client.Authorize runs on every scoped product request with the route's
  exact required scopes; no authority result is cached or retried.
- POST /social/v2/session/bind requires social.messaging AND social.profile and
  binds the approved P256 Product Session to a proven Ed25519/X25519 chat device.
  Only public keys and signed proofs reach the product server.
- Existing device account/keys/status are checked; same-account reapproval reuses
  the existing Chat and Square device without rotating keys or changing ciphertext.
- Web additionally requires the exact Social host-only BrowserSSO grant, same
  account, live generation/introspection, and Origin plus CSRF on mutations.
- New durable ProductBindings is omitempty; schema-5 old HMAC encoding is retained.
  Only expired new associations are pruned; old devices/messages/outbox are not deleted.
- Revoked/local-expired actors, changed account/device/grant, missing scopes and
  degraded authority cannot unlock private routes or fall back to a legacy bearer.
- Web adds actual profile edit, existing conversation list, verified message history,
  encrypted send and exact-ciphertext retry using the EXISTING chatCrypto and outbox.
- Messages not addressed to this device stay explicitly locked; no key import or
  invented historical plaintext is offered. Conversations still require contacts.
- Native identity and explicit chat permission have separate protected SDK namespaces.
  The corresponding App/API bridge uses the same shared proof and existing chat keys.
  Account switching archives old device carriers before selecting a different one.
- Live authorization rejection discards private UI/data and late responses, not
  Standard Wallet. Sign-out retains device keys and pending encrypted messages.
- Scoped sessions do not gain feed/AI/contact permissions by implication; Native
  navigation hides private sections not present in the actual grant.

## Deliberate non-expansion

The new scoped primary path covers profile and conversation/message operations.
Legacy encrypted attachments, Cloud authority and legacy device rotation remain
preserved but are NOT claimed as newly validated scoped-session channels. Scoped
rotation returns explicit recovery guidance without replacing keys. No new chat
protocol, historical-key sharing, automatic private-scope widening or recovery-key
collection was introduced.

## Reproducible build contract for A (not executed by B)

- Vercel project root: apps/social.
- Install: npm ci --ignore-scripts --no-audit --no-fund.
- Build: npm run web:build.
- Output: apps/social/web/dist (project-relative web/dist).
- Contract: apps/social/vercel.json and apps/social/web/build.mjs.
- Web build uses the existing immutable browser SDK; its emitted registry is copied
  from the frozen native 6f registry containing the five exact Social registered scopes.
  The legacy Web vendored snapshot is left unchanged, not falsely relabeled.
- Registry input: src/vendor/product-session-registry.json, 7590 bytes,
  SHA256 e74e1668e631dd623a4364cc9580951a9fe96fcef0c66c5910d84c774f4fdc08.
- The Social daemon constructs exact web/android/ios shared-verifier policies and
  Social BrowserSSO using the EXISTING server TokenKey, without a new browser secret.
- Same-origin /sso/* is proxied to https://api.ynxweb4.com/social/sso/*;
  daemon aliases are inside the existing /social routing boundary.
- /social/* proxies to the existing Social API. /wallet-auth/callback serves the
  built index.html with root-resolved assets. No blank window/tab is opened.
- A must verify reverse-proxy Set-Cookie, Origin, proof-header forwarding, runtime
  source binding and the exact rollback carrier before any single-use deployment.
- Build bytes/output SHA, installed lifecycle and deployed identity are NOT_GENERATED
  or NOT_VERIFIED here. This source handoff is not a deployment lease.

## Executed checks (synthetic/local, not public approval)

- npm ci --ignore-scripts --no-audit --no-fund --prefix packages/wallet-auth: PASS.
- npm ci --ignore-scripts --no-audit --no-fund --prefix apps/social: PASS.
- npm run typecheck --prefix apps/social: PASS.
- npm test --prefix apps/social: 36/36 PASS.
- apps/social/node_modules/.bin/tsx --test apps/social/web/chat-workspace.test.ts:
  4/4 PASS, actual existing Noble encryption/decryption/signature engine, fake HTTP authority.
- node --test apps/social/web/*.test.mjs plus Social registration: 38/38 PASS
  (final private-session-only rerun: 9/9 PASS).
- Shared central-browser session/daemon tests: PASS; 3 opt-in browser tests SKIPPED,
  not counted as installed/browser evidence.
- go test ./internal/social ./internal/productsessionv2 ./cmd/ynx-sociald: PASS.
- Go tests include old mixed-origin authenticated encoding, live authority rejection,
  existing-device reuse/reapproval, persisted bridge restore, account isolation,
  missing scope/key substitution rejection, Web CSRF/generation/revocation checks.

Remaining acceptance gate: A-generated exact compatible artifacts and Central-controlled
installed/public QA. Real account/sign/transaction actions require immediate human
confirmation. No source/tests/receipt here satisfy that gate.
