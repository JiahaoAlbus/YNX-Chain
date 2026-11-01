# P08 minimum real model resource — public interface, no secrets

Existing normal entry: `apps/ai/main.go` ->
`OpenOriginalTaskRuntime(ctx, TaskModelConfig)` -> original
`aigateway.Service.CompleteWithTools/ResumeWithTools`. Source/Native approval
is independent from whether a model is configured or reachable.

The model transport is fixed OpenAI-compatible HTTP Chat Completions. It calls
`POST <provider-base>/chat/completions`, JSON `model/messages/tools`, and consumes
one assistant choice: either normal text or function `tool_calls` (call ID,
function name and JSON argument string), followed by messages with role=tool and
tool_call_id. The concrete model must actually support this tool-calling loop.
Provider identity and model ID are operator-fixed and independently disclosure-
authorized. Per-call timeout is30s, whole task model budget2min, body cap2MiB;
redirects refused. No BFT signer, wallet key or new account is needed for inference.

Root can supply an EXISTING local HTTP model runtime OR an existing approved
remote provider. A remote API key is not intrinsically required by the HTTP
protocol; explicit `YNX_AI_PROVIDER_AUTH=none-loopback` now permits an existing authless
server at a numeric HTTP loopback address (127.0.0.1 or [::1]), with
OPENAI_API_KEY absent. This mode rejects DNS names, non-loopback addresses,
credentials/query/fragment URLs, nonempty provider keys and redirects. The default
`bearer` mode remains unchanged and requires the existing provider credential.
No dummy credential is needed for authless local mode. A bare approved CLI
is not currently a model transport: there is no subprocess executor/CLI flag on
this path. Prefer its existing official compatible server mode. A separate CLI
adapter would be new scoped CODE, not a reason to reuse Codex/ChatGPT OAuth.

Public nonsecret facts Root should identify (not token values):
1. Existing runtime/provider name and owner/custodian; local vs remote.
2. Fixed HTTP base URL (without credentials/query/fragment) and exact served model
   identifier; tool-calling supported by the actual installed/approved model.
3. Provider auth mode and credential-source REFERENCE/presence only. Existing
   server-issued local credential or already-authorized remote provider key is
   held by the original operator; no credential goes in chat or this manifest.
4. Existing chain-status service base URL, with real `GET /status` flat JSON
   `{chainId,height,network,nativeCurrencySymbol}`; native symbol must be YNXT.
5. Original AI gateway access/upstream credential custodians and injection
   references (not values), plus fixed provider disclosure admission owner.
6. Existing budget/no-new-charge permission for that specific resource. No signup,
   purchase, model download or new paid inference is requested by this document.

Current normal injection (original process launcher/custodian, never user/model
request): `YNX_AI_PROVIDER_URL`, `AI_MODEL_NAME`, `YNX_AI_PROVIDER_AUTH`, `OPENAI_API_KEY`,
`YNX_AI_GATEWAY_CHAIN_URL`, `YNX_AI_GATEWAY_API_KEY`,
`YNX_AI_GATEWAY_UPSTREAM_KEY`, `YNX_AI_GATEWAY_UPSTREAM_MODE=authoritative`.
Only the first two and chain URL are public configuration; keys stay in the
existing protected process injection. The app reads no Codex/ChatGPT credentials.
Defaults are https://api.openai.com/v1 and http://127.0.0.1:6420, but defaults
are not evidence of an admitted or usable model/service. No provider has been
called in production. Root can wire independent existing resources using these
references; actual Source/Root/Native absence must not be reported as model quota.

Public resource response sufficient for Root (no secret values): fixed base URL,
exact served model ID, auth mode=bearer or none-loopback, existing custodian and
credential-injection reference/presence (bearer only), chain-status base URL,
existing gateway/upstream credential references and approved no-new-charge budget.
Root can choose an already-running local model without any remote provider key.
The PUBLIC HTTP peers in P08 tests are protocol controls, not installed real LLMs.
No real-model availability, credentials, payment or Native/Source approval is
inferred from these tests or from a normal daemon's unadmitted503 status.

Model/tool outcomes remain UNKNOWN on transport/HTTP failure; the original run
now retains only allowlisted diagnostic causes (auth rejected, known quota,
known rate-limit, unclassified429, service rejection, Source unavailable or
cancel/deadline). Provider body text and arbitrary headers are not persisted.
A diagnostic cause never authorizes automatic retry or overwrites an earlier
cause. Cold GET returns that original failure without another provider call.
