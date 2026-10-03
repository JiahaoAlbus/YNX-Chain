# Approved Workspace browser identity consumer contract

The Go `NewBrowserSSO` constructor supports the original six products plus only these three approved Web identity clients from the existing explicit13 profile:

| product | clientId | origin | redirectUri | audience |
| --- | --- | --- | --- | --- |
| cloud | ynx-cloud-web-v1-sso-v1 | https://web4.ynxweb4.com | https://web4.ynxweb4.com/sso/callback | ynx:cloud:identity |
| docs | ynx-docs-mobile-v1-sso-v1 | https://docs.ynxweb4.com | https://docs.ynxweb4.com/sso/callback | ynx:docs:identity |
| calendar | ynx-calendar-v1-sso-v1 | https://calendar.ynxweb4.com | https://calendar.ynxweb4.com/sso/callback | ynx:calendar:identity |

Each grants only `identity:read`. These IDs preserve the actual approved product registry: Cloud/Docs cannot be derived from `ynx-<product>-v1`. Cloud's exact Web origin is web4. Constructor support does not enable a deployed Central profile; runtime must explicitly adopt the existing13 profile. Default remains6, opt-in remains13. Music/Card/Merchant are not identity members. Other explicit13 products are not automatically added to this constructor.

Existing APIs:

- `NewBrowserSSO(product, authority, cookieKey, targets, transport)` selects fixed tuple and issuer https://wallet-auth.ynxweb4.com. It requires the existing backend-owned cookie key and named target allowlist; it supplies no keys.
- `Start` prepares original PKCE/state/target and host-only sealed pending cookie. Targets are allowed named sections, never arbitrary URLs. Pending redemption expires after2min; original target-only denial recovery remains bounded10min.
- `Callback` redeems the original code through Central HTTP with strict query/state, PKCE, product origin and callback binding. Grant remains identity-only, bounded by original Central5min/session deadlines.
- `Binding` returns a backend-only AES sealed durable binding and original grant. Do not expose its credential to the browser or treat it as business authority.
- `VerifyBinding(ctx, binding, currentAccount)` calls actual Central introspection and compares original subject/account/generation/expiry to fresh authority. Use the currently bound actor; local booleans/cached markers do not authorize.
- `Account` returns a rechecked identity-only view and CSRF token, no grant token, with `privateWorkspaceAuthorized:false`. Temporary failures do not silently clear valid cookies; revocation/generation changes fail closed.
- `Logout` requires exact product Origin and original CSRF, revokes the original grant through Central, and clears identity/pending only on confirmed response. Original bounded signed-out marker/quiet restore suppression remains.

Prepare/redeem/resolve are consumer workflow descriptions, not extra shared RPCs or invented method names. Original products keep exact AES domain, cookie names, TTL/scopes and redirect-deny behavior. Finance retains deployed `YNX Finance SSO cookie v1` key derivation and durable binding readability. The three new products have separate product domains/AAD; Cloud cookies cannot decrypt as Docs/Calendar/Social/Finance cookies.

Identity never authorizes private workspace, documents/calendar/resources or business/payment operations. Product owner must separately consume canonical private Product Sessions and enforce current actor/object/membership/role plus nonce+effect in its original transaction. Revalidation belongs outside the owned store lock. Do not copy Social identity or borrow its audience.

Direct Node interoperability uses explicit reviewed source, original CentralBrowserSessionAuthority/NodeRoutes/store, test-owned0700 temporary state, original software Wallet signing fixture and loopback HTTP. It explicitly signs the existing13 consent in QA. Actual Wallet UI, production backend registration, protected OS signer, profile, deployment and public business acceptance remain unverified.
