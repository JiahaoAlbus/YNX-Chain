# YNX AI central integration status

These files separate local implementation evidence from central deployment claims.

## Wallet/Auth

- `wallet-registry-entry.json` is the exact schema-v2 AI product registration.
- `wallet-auth-vector.json` binds the AI client, bundle, callback, device algorithm, network, ordered scopes, purpose, lifetime, and canonical request digest.
- `wallet-registry.patch` remains a merge input for the Wallet/Auth owner.
- Production must call `verifyCentralWalletSession` transactionally and `assertCentralWalletSessionActive` before every protected use.
- The local verifier is a test fixture only. Until the canonical registry and shared verifier are merged and deployed, production Wallet sign-in remains fail-closed and `integratedCentral` remains false.

## AI Gateway

The POST-body stream contract, stable Provider errors, Product AI Registry and
restricted-context guard are implemented at source commit
`8c7af8d2509a1a0dc2f7d306b0f9c7c5c43ff154` and covered by package and race
tests.

The local contract:

- exposes only `POST /ai/stream`;
- rejects every query string on that endpoint;
- requires `application/json`;
- rejects unknown fields and extra JSON values;
- enforces a 2 MiB body limit;
- validates the 12 supported output-language identifiers;
- requires explicit `selected_files` context before accepting attachments;
- requires exact registry policy, explicit selection, freshness, byte budget and
  permission (where applicable) before accepting product-context references;
- passes only product-context metadata and account/conversation-scoped reference
  hashes until an accepted owner adapter supplies content;
- rejects restricted credentials, PAN/CVV, PEM/seed material and indirect
  attachment injection before provider access;
- bounds context lists, attachment count, type, name, and text size;
- stores only the original prompt hash in Gateway audit records;
- returns stable `code`, `error`, and `requestId` failure envelopes;
- preserves Provider HTTP 429 as `provider_rate_limited` without exposing upstream bodies.

`central-ai-gateway-post.patch` is retained as a historical merge artifact; the checked-in runtime and tests are authoritative. This local implementation is not proof of staging deployment, provider availability, public reachability, or central integration.
