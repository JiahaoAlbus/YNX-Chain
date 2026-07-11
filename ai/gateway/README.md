# AI Gateway

`ynx-ai-gatewayd` is the independent YNX Chain AI Gateway. It calls an OpenAI-compatible provider for chain-aware explanations, streams responses over SSE, and proxies permission/action records to `ynx-chaind`, where they remain authoritative and persistent.

Public `/health` and `/metrics` do not expose keys. Protected routes require `X-YNX-AI-Key` or `Authorization: Bearer ...`. The gateway and chain share a separate `YNX_AI_GATEWAY_UPSTREAM_KEY`; when configured on `ynx-chaind`, direct `/ai/*` calls that bypass the gateway return `401`.

The JSONL audit stores request IDs, timestamps, session IDs, prompt hashes, route/status/outcome, and audit hashes. It does not store raw prompts, access keys, provider keys, private keys, or seed phrases.

Run `make ai-gateway-check` for provider-backed streaming, concurrent session isolation, auth/rate-limit behavior, chain-backed action approval, bypass protection, metrics, and audit-redaction verification.
