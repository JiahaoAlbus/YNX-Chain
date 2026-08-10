# YNX Search external provider adapter

Status: provider-neutral runtime and negative paths implemented locally; no live
provider is configured or verified.

## Separation contract

External provider results use `resultType: external-result` and
`retrieval: external-provider`. They remain distinct from:

- `ynx-index-result`: governed, locally indexed YNX Search results;
- `ai-answer`: inference produced through the separate YNX AI Gateway workflow.

The adapter never merges an external provider item into the governed YNX index,
never labels it as a YNX-owned source, and never represents a provider response
as an AI answer.

## Runtime routes

- `GET /api/external/status`: redacted configuration and separation state.
- `POST /api/external/search`: explicit-opt-in server-side provider request with
  query and page size in a bounded JSON body, not in the URL.

When configuration is incomplete, status remains `unavailable` and search returns
`SEARCH_EXTERNAL_PROVIDER_UNAVAILABLE`. No fixture, synthetic result or fallback
provider is used in the runtime path.

## Required operator configuration

All values are references or public policy facts. Credentials must be placed in
the deployment secret store, never committed or pasted into evidence.

- `YNX_EXTERNAL_SEARCH_PROVIDER`: exact provider identifier expected in responses.
- `YNX_EXTERNAL_SEARCH_URL`: exact official HTTPS JSON endpoint.
- `YNX_EXTERNAL_SEARCH_TOKEN`: server-side credential.
- `YNX_EXTERNAL_SEARCH_RETENTION_DAYS`: provider-reported retention period.
- `YNX_EXTERNAL_SEARCH_RETENTION_POLICY_URL`: public HTTPS retention/privacy policy.

Optional bounded settings:

- `YNX_EXTERNAL_SEARCH_TIMEOUT_MS`: 50–30000, default 5000.
- `YNX_EXTERNAL_SEARCH_MAX_RESPONSE_BYTES`: 1024–2000000, default 512000.
- `YNX_EXTERNAL_SEARCH_MAX_STALENESS_SECONDS`: 1–86400, default 900.

## Provider request

The adapter sends a JSON POST with:

- schema version `1.0.0`;
- normalized query, maximum 256 characters;
- result limit, maximum 10;
- `safeSearch: strict`;
- `resultClass: external-result`.

Redirects are rejected. The provider endpoint must resolve only to public
addresses. The credential remains in the Authorization header and is never
returned by status, health, logs or API responses.

## Provider response

The provider must return JSON with:

- `schemaVersion: 1.0.0`;
- exact configured `provider`;
- `health: available|degraded`;
- valid `asOf` within the configured staleness window;
- a bounded results array;
- optional rate-limit facts.

Each result must have a bounded title, public HTTPS URL whose DNS records are
also public, and bounded snippet. The retention policy link passes the same
public-DNS check before any provider request is sent.
Language and publication time are optional but validated when present. Duplicate
URLs are removed without inventing replacements.

## Failure semantics

- incomplete configuration: 503 `SEARCH_EXTERNAL_PROVIDER_UNAVAILABLE`;
- unsafe configuration: 503 `SEARCH_EXTERNAL_PROVIDER_CONFIGURATION`;
- timeout: 504 `SEARCH_EXTERNAL_PROVIDER_TIMEOUT`;
- upstream rate limit: 429 `SEARCH_EXTERNAL_PROVIDER_RATE_LIMIT` with bounded
  `Retry-After` when supplied;
- stale response: 502 `SEARCH_EXTERNAL_PROVIDER_STALE`;
- malformed, oversized, identity-mismatched or unsafe response: bounded provider
  failure, never partial synthetic success.

Every error receives Request, Trace and Error correlation through the common
Search observability layer. Query strings and upstream body contents are not
included in logs.

## Local verification boundary

`test/external-search.test.js` uses deterministic injected provider responses to
verify the adapter contract and negative paths. These tests prove local behavior
only. Provider-backed Testnet status requires an approved provider, credential,
exact deployed source, observed API response, quota/retention evidence and
central Integration/Security acceptance.
