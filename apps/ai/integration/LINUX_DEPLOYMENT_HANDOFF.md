# Fixed Linux AI deployment candidate

## Immutable payload

- Product source: `170f8e1e00e97175e681d4fa161943add6660e0f`.
- Source tree: `74e7b8ed6553cb304fc0e6e19e69cb9dcfc07611`.
- Wallet private browser SDK: `9840ef871165eb523c4e7a3d48964dd25f8dee8e`.
- Archive: `ai-170f8e1e-linux-amd64.tar.gz`.
- Archive SHA256: `b94f7b770bca4e306acc92ca2f8238799902d1ed3643a0362da30e81f5d9b3d6`.
- Product binary SHA256: `674bfdcc2efac22d465def9e9a0a1736c1f51cc5e11e43897908c447273457e4`.
- Model Gateway binary SHA256: `61f2e66b7fdf4056ff54e9b75269e3a012427906c25415c780914ca065e291a7`.

Both binaries are statically linked Linux x86-64 ELF files, cross-built with
`CGO_ENABLED=0`, `-trimpath`, and embedded commit/release identity. The archive
contains exported fixed source, embedded and separately exported Web assets,
version metadata, a 315-file SHA256 manifest and deployment documentation.
It is held in the coordinator's `release/ai-170f8e1e-linux-amd64` directory.
Later documentation commits do not change this payload or its source identity.

## Live mapping observed 2026-09-12

- `ynx-ai-client.service`, user `ynx`, listens on `127.0.0.1:18114`.
- Previous serving executable: `/opt/ynx-ai-client/releases/16d6d71e/ynx-ai-client`.
- Product environment file: `/etc/ynx/ynx-ai-client.env`.
- Product state: `/var/lib/ynx-ai-client/state.json`, mode `0600`, UID `995`, GID `986`.
- `ynx-ai-gatewayd.service`, user `ynx`, listens on `127.0.0.1:6429`.
- Previous Gateway executable: `/usr/local/bin/ynx-ai-gatewayd`.
- Gateway environment files: `/etc/ynx/ynx-chaind.env` and `/etc/ynx/ynx-ai-gatewayd.env`.
- Gateway chain endpoint: `http://127.0.0.1:6420`.
- Gateway audit log: `/var/log/ynx-chain/ai-gateway-audit.jsonl`.
- Active Caddy configuration confirms `assistant.ynxweb4.com` forwards to `127.0.0.1:18114`.
- Port `6438` belongs to the economics monitoring process, not this AI product. Do not modify it.

The active Caddy observation supersedes the archive checklist's earlier unknown
proxy mapping. Keep the archive immutable. Recheck live unit identities at
cutover because PIDs and effective overrides can change.

## Cutover constraints

Preserve the existing environment, service hardening, state ownership and content
encryption key. Stage the release immutably; only the release coordinator changes
the actual service. Keep the product on port `18114` and the model Gateway on
`6429`; no Caddy mutation is required for this mapping.

First stage the upgraded model Gateway for BYOK. Configure an operator-approved
`YNX_AI_BYOK_PROVIDERS_JSON` catalog there. Provide the same new independent
`YNX_AI_BYOK_ACCESS_KEY` to both services through protected environment files.
The key must be at least 32 bytes and different from the legacy Gateway access
key. Preserve hosted provider credentials and `AI_MODEL_NAME`; no secret values
belong in this repository or deployment logs.

The product requires `YNX_AI_WALLET_GATEWAY_ORIGIN=https://wallet-auth.ynxweb4.com`
and `YNX_AI_ALLOW_LOCAL_FIXTURE_AUTH=0`. Do not migrate legacy Wallet authority
state, browser sessions, replay records or revocations into the new authority.

Stop the existing product writer before taking the final private state snapshot.
Cold-check a separate private copy with the candidate and the existing content
key. Never run two writers against the serving file. Do not overwrite active
state with a stale backup after traffic resumes. Old binaries may discard the
additive `providerCredentials` field when saving; rollback requires compatibility
with the current state, not merely possession of an old executable.

## Post-deployment acceptance, still outstanding

1. Match public/backend source identity to the intended payload; confirm callback,
   private SDK/registry loading and `/api/wallet/config` against the actual origin.
2. Keep standard YNX Wallet and MetaMask identity separate from private AI login.
   An explicit Open action is not successful authentication. Require a real
   approved callback, authority completion and protected AI session readback.
3. Exercise non-sensitive private reads, refresh, expiry and revocation. Confirm
   late responses cannot restore an invalidated account or session.
4. Run bounded hosted generation and separately authorized BYOK generation.
   Preserve provider 429/failure outcomes; BYOK availability does not prove the
   default hosted provider has recovered. Record actual provider-backed completion.
5. Check user isolation, key deletion, cost/usage uncertainty and action review.
   Scope authorization does not replace confirmation of sensitive business actions.
6. Confirm the official website links to the public AI entry. Repository delivery,
   deployment and website entry are separate receipts, not interchangeable proof.

At the last public observation the hosted model was `gpt-4.1-mini`,
`generationLive=false`, provider availability was false with a recorded prior
429, and `/api/wallet/config` returned 404. These observations are historical,
not a claim about the result of the forthcoming deployment.
