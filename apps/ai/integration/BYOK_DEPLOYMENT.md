# AI hosted and BYOK deployment handoff

This is a candidate configuration contract, not a deployment receipt.

## Services and secrets

- Product: `apps/ai`, normally loopback port 6438.
- Model Gateway: `cmd/ynx-ai-gatewayd`, normally loopback port 6429.
- Wallet session authority: `https://wallet-auth.ynxweb4.com`.
- Product sets `YNX_AI_WALLET_GATEWAY_ORIGIN` to that exact authority.
- Existing hosted settings remain: `YNX_AI_PROVIDER_URL`, `AI_MODEL_NAME`, `OPENAI_API_KEY` on Gateway; `YNX_AI_GATEWAY_API_KEY` authenticates the product to Gateway.
- Set a separate `YNX_AI_BYOK_ACCESS_KEY` on both product and Gateway. Use at least 32 bytes and do not reuse `YNX_AI_GATEWAY_API_KEY`.
- Configure `YNX_AI_BYOK_PROVIDERS_JSON` on Gateway with operator-approved IDs, base URLs and explicit model lists. No user-controlled endpoint URLs are accepted.
- Keep `YNX_AI_CLIENT_CONTENT_KEY` and `YNX_AI_CLIENT_STATE_PATH` stable across the product upgrade. User provider keys are encrypted under this key with account/provider/model binding.
- No configuration secret belongs in source control, command-line arguments, browser storage, logs, screenshots or handoff messages.

Catalog shape, using a deliberately non-routable example:

```json
{"example":{"url":"https://provider.example/v1","models":["approved-model"]}}
```

## Request flow

1. The browser receives provider IDs and model names through the authenticated product endpoint `/api/provider-catalog`. Provider base URLs and service secrets are not returned.
2. The user explicitly confirms storing a key through `PUT /api/provider-credentials/{provider}`. Reads return metadata only. Account identity is taken from the verified private session.
3. The user selects hosted default or a saved provider in the composer. Only the provider ID and model selection enter the browser generation request; the saved key does not.
4. Hosted generation keeps `/ai/stream`. BYOK generation resolves the current user's encrypted key and uses `/ai/byok/stream` with both service access keys over HTTPS or loopback. Redirects are not followed.
5. Gateway validates its provider/model allowlist and puts the user key only in the selected provider's Authorization header. It never adds the key to model messages or audit records.

## Data and rollback boundaries

- Back up encrypted product state before upgrade using the existing authenticated backup command. Protect the content encryption key separately.
- Account-data deletion removes active provider credential records. Individual key removal does not revoke that key at the external provider.
- Previously created encrypted backups can contain older credential records. Restoring one may restore those records; backup retention and external key rotation remain separate operator responsibilities.
- A source downgrade that does not preserve `providerCredentials` may discard those records on its next save. Do not claim arbitrary old binaries are schema-compatible rollback targets.
- Choose and retain a tested compatible binary plus its matching state snapshot before publishing. Public rollback version and exercise evidence are still required.

## Acceptance still required

- Confirm the deployed product serves `/api/wallet/config` and binds source identity to the public assets and backend.
- Confirm actual Wallet callback, session readback, fresh API proofs, revocation and restart against the deployed authority.
- Run a bounded hosted generation and a separately confirmed BYOK generation with real approved credentials, preserving provider failure status and never substituting an answer.
- Confirm user isolation, deletion, restore and failure handling in the installed/public lifecycle. Local mock-provider tests do not establish these results.

## Public observation

Read-only observation on 2026-09-12: `/api/public-status` returned HTTP 200 with `asOf=2026-09-12T09:47:13Z`, `generationLive=false`, `providerAvailable=false`, hosted model `gpt-4.1-mini`, and a recorded latest bounded provider run of 429. This was not a new generation attempt. `/api/wallet/config` returned HTTP 404, so the candidate configuration endpoint was not available on that public origin at observation time.
