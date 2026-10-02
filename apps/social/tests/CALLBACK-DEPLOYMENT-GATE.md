# Standalone callback deployment configuration

The configuration inherits the unchanged `apps/social/vercel.json` and callback HTML from immutable `c71e0a51bb768e60c0d45454b9f7d4e4a013be2d`; both blobs are byte-identical to admitted `0f4a9034446d207c457315ff3597e907397a57ef`. No c71 product runtime is integrated by this change. The reviewed HTML fixture is test-only. Its original build script already emits independent HTML and the callback-entry bundle without the chat SDK.

The exact `/matrix/login/callback` rewrite serves `/matrix/login-callback.html`. Canonical and physical callback paths, plus the callback module, receive no-store for browser/CDN, no-referrer, nosniff and an exact inline script/style hash CSP. The callback cannot connect to network services. No COOP change is made: original same-origin opener delivery remains required. Existing `/sso`, `/social` and Wallet callback rewrites and build settings remain unchanged, including the original API/Cloud service prefix.

The fixed hash must be regenerated and independently reviewed when the real callback HTML changes. Full Social source composition and exact build output membership must be validated before deployment. Tests use a real Chromium engine and the original independent callback bundle under intercepted HTTPS-origin transport, with only synthetic nonsecret inputs. This is configuration/source engineering evidence, not real TLS, homeserver authentication or production acceptance.

Command (use the explicit immutable reference with existing locked dependencies; do not install):

```
YNX_QA_SOCIAL_CALLBACK_REFERENCE=/tmp/ynx-socialc71-independent-aqgqhhei node --test apps/social/tests/vercel-callback-config.test.mjs
```

## Required deployment gates still unverified

- `INITIAL_HTTP_QUERY_LOG_SUPPRESSION = NOT_VERIFIED`: response headers, CSP and frontend `replaceState` do not suppress initial URL query collection by Vercel access/security/APM logs, other proxies or an upstream homeserver. Verify the actual hosting logging policy before any real `loginToken` callback. Do not claim no logging from a local browser test or add a fake configuration flag.
- Real fixed HS/RP, existing full MXID/external-ID mapping provenance and protected server key/config registration remain unconfirmed. Keep the OP/configuration disabled; never derive or replace an MXID, use QA-AS/admin credentials, or mount the historical Matrix credential Issue route.
- Production callback response headers, exact standalone build closure and metadata routing still require HTTPS readback after the coherent reviewed product source release. Actual Matrix login/device revocation/two-user E2EE are separate gates.

Configuration format and response header semantics follow the official [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json) and [cache-control documentation](https://vercel.com/docs/caching/cache-control-headers). They do not establish the platform logging policy.
