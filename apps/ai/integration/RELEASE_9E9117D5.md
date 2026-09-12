# Exact chat lifecycle release handoff

## Immutable runtime source

- AI runtime commit: 9e9117d523c498310058eb8c776f62c8a9fca2e5
- Tree: ad09bcf7bb01e4372c83c52ac6c6fddaeb4a9fd1
- Branch: codex/final-ai
- Prior public runtime reported by release owner: 2c39c63b43d4e41de925c7542cd5fef53bfada17

Export and build the exact runtime commit, not a prior 2c39 archive or an
uncommitted checkout. Later documentation-only commits do not change this
runtime identity. No 9e binary/archive hash is claimed by this document;
the release owner must record hashes for its newly built artifacts.

Rebuild both apps/ai and cmd/ynx-ai-gatewayd. The client embeds the updated
browser cancellation handler and owns encrypted-history rollback and BYOK
provider labels. The Gateway owns final-answer validation and model policy.
Updating only static assets or only one binary does not deliver all changes.

Preserve client 18114, Gateway 6429, existing state and keys, Caddy routing,
and the current default model. Do not modify Developer 18111 or Ollama 11434,
start another model daemon, or enable automatic fallback. The sole release
owner schedules this after Card, with its normal active-request drain,
state-preserving cold check, rollback capture, and source-bound public checks.

## Local validation

Go aigateway/aiproduct tests passed, both executable packages compiled, and
all 47 frontend tests passed. See CHAT_LIFECYCLE_CANDIDATE.md for coverage
and limitations. These are not authenticated public lifecycle acceptance.

## Bounded model comparison

The existing qwen2.5:1.5b received the same non-sensitive wallet question,
with only the new 9e system instruction added. This isolates that instruction;
it does not reproduce the full Gateway prompt or private product request.
One request, one thread, 96-token budget, 1024 context, 60-second HTTP deadline,
65-second process deadline, no retry, and no provider configuration change.

The result completed in 7.688 seconds with 42 tokens, stop termination, and
no thinking output. It distinguished account connection from separately
reviewed transfer approval and said private keys must not be shared.
This narrow answer was relevant and consistent with the intended boundary.
One sample does not establish broad quality or a performance improvement;
the prior 12.1-second sample had a different prompt and may differ in caching.

Raw receipt: coordination-01a094cc/release/ai-qwen25-15b-9e-policy-probe02.json
under the shared audit directory. Its conservative qualityAccepted=false and
productLifecycleAccepted=false flags remain unchanged. Default hosted and
BYOK authenticated generation, cancellation, restart, and revocation still
need actual public user-flow evidence and user-controlled Wallet approval.
