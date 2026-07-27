# YNX AI central integration status

These files separate local implementation evidence from central deployment claims.

## Wallet/Auth

- `wallet-registry-entry.json` is the exact schema-v2 AI product registration.
- `wallet-auth-vector.json` binds the AI client, bundle, callback, device algorithm, network, ordered scopes, purpose, lifetime, and canonical request digest.
- `wallet-registry.patch` remains a merge input for the Wallet/Auth owner.
- Production must call `verifyCentralWalletSession` transactionally and `assertCentralWalletSessionActive` before every protected use.
- The local verifier is a test fixture only. Until the canonical registry and shared verifier are merged and deployed, production Wallet sign-in remains fail-closed and `integratedCentral` remains false.

## AI Gateway

The POST-body stream contract and stable Provider-error semantics are implemented in `internal/aigateway/server.go` at source commit `2678a8b0cf3f9463ec7fc205caab486993bf5f18` and covered by package and race tests.

The local contract:

- exposes only `POST /ai/stream`;
- rejects every query string on that endpoint;
- requires `application/json`;
- rejects unknown fields and extra JSON values;
- enforces a 2 MiB body limit;
- validates the 12 supported output-language identifiers;
- requires explicit `selected_files` context before accepting attachments;
- bounds context lists, attachment count, type, name, and text size;
- stores only the original prompt hash in Gateway audit records;
- returns stable `code`, `error`, and `requestId` failure envelopes;
- preserves Provider HTTP 429 as `provider_rate_limited` without exposing upstream bodies.

`central-ai-gateway-post.patch` is retained as a historical merge artifact; the checked-in runtime and tests are authoritative. This local implementation is not proof of staging deployment, provider availability, public reachability, or central integration.
