import { createFairQueue } from "./fair-queue.mjs";
import { readHostedCompletion } from './hosted-completion.mjs';
import { existingHostedRequest, validatedModelAttachments } from "./hosted-request.mjs";
import { assertNoSelectedSecrets } from './context-secrets.mjs';
import { assertExpectedIdentity, consumerIdentityBinding } from "../../codeoss-service/src/identity-consumer-binding.mjs";

const PROTOCOL = "ynx-code-model-router/v1";
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const PROVIDERS = Object.freeze({
  openai: Object.freeze({
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/responses",
    defaultModel: "gpt-5-mini",
    keyMode: "request-only",
  }),
  anthropic: Object.freeze({
    label: "Anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-sonnet-4-5",
    keyMode: "request-only",
  }),
  google: Object.freeze({
    label: "Google Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    defaultModel: "gemini-2.5-flash",
    keyMode: "request-only",
  }),
  xai: Object.freeze({
    label: "xAI",
    endpoint: "https://api.x.ai/v1/chat/completions",
    defaultModel: "grok-code-fast-1",
    keyMode: "request-only",
  }),
});

export function createModelRouter({
  fetchImpl = globalThis.fetch,
  hostedBaseURL = process.env.YNX_CODE_HOSTED_AI_URL ||
    "http://127.0.0.1:18111/ai-build",
  hostedModel = process.env.YNX_CODE_HOSTED_AI_MODEL || "qwen3:4b",
  maxConcurrent = Number(process.env.YNX_CODE_AI_CONCURRENCY || 4),
  maxQueued = Number(process.env.YNX_CODE_AI_QUEUE || 64),
  maxPerOwner = Number(process.env.YNX_CODE_AI_OWNER_CONCURRENCY || 1),
  maxQueuedPerOwner = Number(process.env.YNX_CODE_AI_OWNER_QUEUE || 8),
  maxHostedConcurrent = Number(process.env.YNX_CODE_HOSTED_AI_CONCURRENCY || Math.min(2, maxConcurrent)),
  queueTimeoutMs = Number(process.env.YNX_CODE_AI_QUEUE_TIMEOUT_MS || 60_000),
  timeoutMs = Number(process.env.YNX_CODE_AI_TIMEOUT_MS || 180_000),
  ownerForRequest,
  verifyIdentity,
  activity,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!/^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(hostedBaseURL))
    throw new Error("Hosted AI must use a fixed loopback service boundary.");
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 64)
    throw new Error("AI concurrency must be between 1 and 64.");
  if (!Number.isInteger(maxQueued) || maxQueued < 0 || maxQueued > 10_000)
    throw new Error("AI queue must be between 0 and 10000.");
  for (const [name, value, maximum] of [
    ["Owner concurrency", maxPerOwner, maxConcurrent],
    ["Owner queue", maxQueuedPerOwner, 10_000],
    ["Hosted concurrency", maxHostedConcurrent, maxConcurrent],
    ["Queue timeout", queueTimeoutMs, 600_000],
    ["Model timeout", timeoutMs, 600_000],
  ]) if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new Error(`${name} must be between 1 and ${maximum}.`);
  const queue = createFairQueue({ maxConcurrent, maxQueued, maxPerOwner,
    maxQueuedPerOwner, maxHostedConcurrent, queueTimeoutMs, run });

  function catalog() {
    return {
      protocolVersion: PROTOCOL,
      hosted: {
        id: "ynx-hosted",
        label: "YNX hosted open model",
        model: null,
        configuredModel: hostedModel,
        modelConfidence: 'unknown',
        generationAuthority: 'NOT_SUPPLIED',
        generationAvailable: false,
        managedSession: true,
        credentialMode: "server-managed",
        availability: 'generation-authority-not-supplied',
      },
      bringYourOwnKey: Object.entries(PROVIDERS).map(([id, value]) => ({
        id,
        label: value.label,
        defaultModel: value.defaultModel,
        credentialMode: value.keyMode,
      })),
      localFamilies: ["Qwen", "Llama", "DeepSeek"],
      ...queue.state(),
      scheduling: "round-robin-by-authenticated-owner",
      capacityScope: "single-router-process",
    };
  }

  async function hostedHealth() {
    const unavailable = reason => ({ available: false, serviceReachable: false,
      providerConfigured: null, provider: null, configuredModel: null, model: null, actualModel: null,
      modelConfidence: 'unknown', generationAuthority: 'NOT_SUPPLIED', active: null, queued: null, reason });
    try {
      const response = await fetchImpl(`${stripSlash(hostedBaseURL)}/health`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(timeoutMs, 2_500)),
      });
      if (!response.ok) return unavailable('health_request_failed');
      const value = await response.json().catch(() => null);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable('health_invalid');
      const model = typeof value.model === 'string' && MODEL_PATTERN.test(value.model) ? value.model : null;
      return {
        available: false,
        serviceReachable: true,
        providerConfigured: typeof value.providerConfigured === 'boolean' ? value.providerConfigured : null,
        provider: typeof value.provider === 'string' && value.provider.length > 0 && value.provider.length <= 120 ? value.provider : null,
        configuredModel: model,
        model: null, actualModel: null, modelConfidence: 'unknown', generationAuthority: 'NOT_SUPPLIED',
        active: Number.isSafeInteger(value.active) && value.active >= 0 ? value.active : null,
        queued: Number.isSafeInteger(value.queued) && value.queued >= 0 ? value.queued : null,
        reason: 'generation_authority_not_supplied',
      };
    } catch {
      return unavailable('health_unavailable');
    }
  }

  function generate(request) {
    const input = validateRequest(request);
    if (ownerForRequest && !input.ownerId)
      throw fault("An authenticated AI owner is required.", "model_owner_required", 401);
    if (input.provider === 'ynx-hosted') {
      // Source/schema checks are independent of generation admission. A Wallet
      // owner or assertCurrent callback is not the missing producer ai:generate
      // principal/project/current authority, and must not open this boundary.
      if (input.hostedSession) {
        try { existingHostedRequest(input); } catch (error) { return Promise.reject(error); }
      }
      return Promise.reject(fault('Hosted AI service authentication and original generation/project/current authority have not been supplied.', 'model_supply_not_supplied', 503));
    }
    const schedule = (signal) => queue.schedule({ ...input, ownerId: input.ownerId || "internal",
      signal: signal ? (input.signal ? AbortSignal.any([signal, input.signal]) : signal) : input.signal });
    return activity ? activity.operation("ai", schedule) : schedule();
  }

  async function run(input) {
    if (input.signal?.aborted) throw abortedFault();
    await input.assertCurrent?.();
    if (input.signal?.aborted) throw abortedFault();
    const started = performance.now();
    const result =
      input.provider === "ynx-hosted"
        ? await hosted(input)
        : await bringYourOwnKey(input);
    return {
      ...result,
      protocolVersion: PROTOCOL,
      provider: input.provider,
      model: result.model,
      text: result.text,
      usage: result.usage,
      durationMs: Math.round(performance.now() - started),
      credentialPersisted: false,
    };
  }

  async function hosted(input) {
    let response;
    const signal = combinedSignal(input.signal, timeoutMs);
    const body = input.hostedSession ? existingHostedRequest(input) : {
      prompt: `${input.system}\n\n${input.prompt}`,
      outputLanguage: input.outputLanguage,
      attachments: [],
      maxOutputTokens: input.maxOutputTokens,
      responseFormat: input.responseFormat,
    };
    try {
      if (signal.aborted) throw signal.reason;
      input.onDispatch?.();
      response = await fetchImpl(`${stripSlash(hostedBaseURL)}/ai/stream`, {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
          "x-ynx-ai-provider": "ynx-local",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw modelConnectionFault(error, input.signal, "YNX hosted model");
    }
    if (!response.ok)
      throw upstreamFault(response.status, "YNX hosted model");
    return readHostedCompletion(response, { signal, callerSignal: input.signal, sessionId: input.hostedSession, onOperation: input.onOperation });
  }

  async function bringYourOwnKey(input) {
    const spec = PROVIDERS[input.provider];
    const request = providerRequest(input.provider, spec, input);
    let response;
    try {
      response = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: combinedSignal(input.signal, timeoutMs),
      });
    } catch (error) {
      throw modelConnectionFault(error, input.signal, "Model provider");
    }
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw upstreamFault(response.status, spec.label);
    return parseProvider(input.provider, input.model, value);
  }

  async function handler(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname !== "/runtime/models") return false;
    try {
      // Catalog admission follows the same Wallet actor the UI reviewed. An
      // unrelated guest workspace cookie cannot admit or retire that actor.
      const identity = verifyIdentity ? await verifyIdentity(request) : null;
      let binding;
      if (verifyIdentity) {
        assertExpectedIdentity(request, identity);
        binding = consumerIdentityBinding(identity);
      } else if (ownerForRequest && !ownerForRequest(request)) {
        throw fault("A signed workspace session is required.", "workspace_session_required", 401);
      }
      if (request.method !== "GET")
        throw fault("Method not allowed.", "method_not_allowed", 405);
      const health = await hostedHealth();
      if (verifyIdentity) {
        consumerIdentityBinding(identity);
        const current = await verifyIdentity(request);
        assertExpectedIdentity(request, current);
        if (consumerIdentityBinding(current) !== binding)
          throw fault("Wallet identity changed. Refresh your Wallet projects.", "model_identity_changed", 401);
        consumerIdentityBinding(identity);
      }
      json(response, 200, { ...catalog(), hosted: { ...catalog().hosted, ...health } });
    } catch (error) {
      json(response, error.status || 503, {
        error: error.message || "Wallet identity verification is unavailable.",
        code: error.code || "model_identity_unavailable",
      });
    }
    return true;
  }

  return { protocolVersion: PROTOCOL, catalog, hostedHealth, generate, handler };
}

export function validateRequest(value) {
  if (!value || typeof value !== "object")
    throw fault("Model request is required.", "invalid_model_request", 400);
  const provider = String(value.provider || "ynx-hosted").toLowerCase();
  const attachments = validatedModelAttachments(value.attachments);
  if (provider === 'ynx-hosted' && attachments.length && !value.hostedSession)
    throw fault('Selected files require a server-owned conversation.', 'model_session_invalid', 400);
  if (provider !== "ynx-hosted" && !PROVIDERS[provider])
    throw fault("AI provider is not allowlisted.", "provider_not_allowlisted", 400);
  const prompt = typeof value.prompt === "string" ? (value.hostedSession ? value.prompt : value.prompt.trim()) : "";
  const system = typeof value.system === "string" ? value.system.trim() : "";
  if (prompt.trim().length < 4 || prompt.length > 96 * 1024 || system.length > 16 * 1024)
    throw fault("AI context exceeds its bounded request size.", "invalid_model_context", 400);
  assertNoSelectedSecrets(prompt, system);
  const apiKey = typeof value.apiKey === "string" ? value.apiKey : "";
  if (provider !== "ynx-hosted" && (apiKey.length < 12 || apiKey.length > 512))
    throw fault("A request-only provider API key is required.", "provider_key_required", 401);
  const requestedModel = String(value.model || "").trim();
  if (requestedModel && !MODEL_PATTERN.test(requestedModel))
    throw fault("Model identifier is invalid.", "invalid_model", 400);
  if (value.hostedSession !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.hostedSession))
    throw fault("A server-owned model conversation is required.", "model_session_invalid", 400);
  return {
    provider,
    attachments,
    hostedSession: value.hostedSession,
    ownerId: typeof value.ownerId === "string" && value.ownerId.length > 0 && value.ownerId.length <= 256
      ? value.ownerId : undefined,
    model: requestedModel || (provider === "ynx-hosted" ? null : PROVIDERS[provider].defaultModel),
    apiKey,
    prompt,
    system,
    outputLanguage: /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value.outputLanguage || "")
      ? value.outputLanguage
      : "en",
    maxOutputTokens: Math.max(128, Math.min(Number(value.maxOutputTokens || 2048), 8192)),
    responseFormat: value.responseFormat === "json" ? "json" : undefined,
    signal: isAbortSignal(value.signal) ? value.signal : undefined,
    assertCurrent: typeof value.assertCurrent === 'function' ? value.assertCurrent : undefined,
    onDispatch: typeof value.onDispatch === 'function' ? value.onDispatch : undefined,
    onOperation: typeof value.onOperation === 'function' ? value.onOperation : undefined,
  };
}

function isAbortSignal(value) {
  return value && typeof value === "object" && typeof value.aborted === "boolean" &&
    typeof value.addEventListener === "function";
}

function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function modelConnectionFault(error, signal, label) {
  if (signal?.aborted) return abortedFault();
  if (error?.name === "TimeoutError" || error?.name === "AbortError")
    return fault(`${label} timed out. Try again or choose a request-only provider.`, "model_timeout", 504);
  return fault(`${label} connection failed.`, "provider_unavailable", 502);
}

function abortedFault() {
  return fault("AI request was cancelled after the client disconnected.", "model_request_cancelled", 499);
}

function providerRequest(provider, spec, input) {
  // BYOK receives the same approved files; it has no Gateway attachment schema.
  if (input.attachments.length) input = { ...input, prompt: `${input.prompt}\n\nExplicitly approved project files:\n${JSON.stringify(input.attachments)}` };
  if (provider === "openai")
    return {
      url: spec.endpoint,
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
      body: {
        model: input.model,
        store: false,
        max_output_tokens: input.maxOutputTokens,
        instructions: input.system,
        input: input.prompt,
      },
    };
  if (provider === "anthropic")
    return {
      url: spec.endpoint,
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: {
        model: input.model,
        max_tokens: input.maxOutputTokens,
        system: input.system,
        messages: [{ role: "user", content: input.prompt }],
      },
    };
  if (provider === "google")
    return {
      url: `${spec.endpoint}/${encodeURIComponent(input.model)}:generateContent`,
      headers: { "x-goog-api-key": input.apiKey, "content-type": "application/json" },
      body: {
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.prompt }] }],
        generationConfig: { maxOutputTokens: input.maxOutputTokens, temperature: 0.2 },
      },
    };
  return {
    url: spec.endpoint,
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: {
      model: input.model,
      stream: false,
      temperature: 0.2,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt },
      ],
    },
  };
}

function parseProvider(provider, requestedModel, value) {
  if (provider === "openai") {
    const text = typeof value.output_text === "string"
      ? value.output_text
      : (value.output || []).flatMap((item) => item.content || []).filter((part) => part.type === "output_text").map((part) => part.text || "").join("");
    return output(text, value.model || requestedModel, normalizeUsage(value.usage));
  }
  if (provider === "anthropic")
    return output(
      (value.content || []).filter((item) => item.type === "text").map((item) => item.text || "").join(""),
      value.model || requestedModel,
      { inputTokens: numberOrNull(value.usage?.input_tokens), outputTokens: numberOrNull(value.usage?.output_tokens) },
    );
  if (provider === "google")
    return output(
      (value.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join(""),
      value.modelVersion || requestedModel,
      { inputTokens: numberOrNull(value.usageMetadata?.promptTokenCount), outputTokens: numberOrNull(value.usageMetadata?.candidatesTokenCount) },
    );
  return output(value.choices?.[0]?.message?.content, value.model || requestedModel, normalizeUsage(value.usage));
}

function output(text, model, usage = { inputTokens: null, outputTokens: null }) {
  if (typeof text !== "string" || !text.trim())
    throw fault("Model provider returned no usable text.", "empty_model_output", 502);
  if (Buffer.byteLength(text) > 2 * 1024 * 1024)
    throw fault("Model output exceeded the response boundary.", "model_output_too_large", 502);
  return { text, model: model === null ? null : String(model).slice(0, 120), usage };
}
function normalizeUsage(value) {
  return {
    inputTokens: numberOrNull(value?.input_tokens ?? value?.prompt_tokens),
    outputTokens: numberOrNull(value?.output_tokens ?? value?.completion_tokens),
  };
}
function numberOrNull(value) { return Number.isFinite(value) ? Number(value) : null; }
function upstreamFault(status, provider) {
  if (status === 401 || status === 403)
    return fault(`${provider} rejected the request-only credential.`, "provider_auth_failed", 401);
  if (status === 429)
    return fault(`${provider} rate limit reached.`, "provider_rate_limited", 429);
  return fault(`${provider} request failed.`, "provider_request_failed", 502);
}
function stripSlash(value) { return value.replace(/\/$/, ""); }
function fault(message, code, status) { return Object.assign(new Error(message), { code, status }); }
function json(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

export const MODEL_ROUTER_PROTOCOL = PROTOCOL;
