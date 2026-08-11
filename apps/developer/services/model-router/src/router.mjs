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
  timeoutMs = Number(process.env.YNX_CODE_AI_TIMEOUT_MS || 180_000),
  ownerForRequest,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!/^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(hostedBaseURL))
    throw new Error("Hosted AI must use a fixed loopback service boundary.");
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 64)
    throw new Error("AI concurrency must be between 1 and 64.");
  if (!Number.isInteger(maxQueued) || maxQueued < 0 || maxQueued > 10_000)
    throw new Error("AI queue must be between 0 and 10000.");
  const queue = [];
  let active = 0;

  function catalog() {
    return {
      protocolVersion: PROTOCOL,
      hosted: {
        id: "ynx-hosted",
        label: "YNX hosted open model",
        model: hostedModel,
        managedSession: true,
        credentialMode: "server-managed",
        availability: "health-check-required",
      },
      bringYourOwnKey: Object.entries(PROVIDERS).map(([id, value]) => ({
        id,
        label: value.label,
        defaultModel: value.defaultModel,
        credentialMode: value.keyMode,
      })),
      localFamilies: ["Qwen", "Llama", "DeepSeek"],
      active,
      queued: queue.length,
      maxConcurrent,
      maxQueued,
    };
  }

  async function hostedHealth() {
    try {
      const response = await fetchImpl(`${stripSlash(hostedBaseURL)}/health`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(timeoutMs, 2_500)),
      });
      const value = await response.json().catch(() => ({}));
      return {
        available: response.ok && value.available !== false,
        provider: String(value.provider || "ynx-local-open-model").slice(0, 120),
        model: String(value.model || hostedModel).slice(0, 120),
        active: Number(value.active || 0),
        queued: Number(value.queued || 0),
      };
    } catch {
      return {
        available: false,
        provider: "ynx-local-open-model",
        model: hostedModel,
        active: 0,
        queued: 0,
      };
    }
  }

  function generate(request) {
    const input = validateRequest(request);
    if (input.signal?.aborted)
      return Promise.reject(abortedFault());
    if (active >= maxConcurrent && queue.length >= maxQueued)
      return Promise.reject(
        fault("AI capacity is full. Retry shortly.", "model_queue_full", 503),
      );
    return new Promise((resolve, reject) => {
      const task = { input, resolve, reject, onAbort: null };
      if (input.signal) {
        task.onAbort = () => {
          const index = queue.indexOf(task);
          if (index < 0) return;
          queue.splice(index, 1);
          reject(abortedFault());
        };
        input.signal.addEventListener("abort", task.onAbort, { once: true });
      }
      queue.push(task);
      pump();
    });
  }

  function pump() {
    while (active < maxConcurrent && queue.length) {
      const task = queue.shift();
      if (task.onAbort)
        task.input.signal.removeEventListener("abort", task.onAbort);
      if (task.input.signal?.aborted) {
        task.reject(abortedFault());
        continue;
      }
      active += 1;
      run(task.input)
        .then(task.resolve, task.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  async function run(input) {
    const started = performance.now();
    const result =
      input.provider === "ynx-hosted"
        ? await hosted(input)
        : await bringYourOwnKey(input);
    return {
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
    try {
      response = await fetchImpl(`${stripSlash(hostedBaseURL)}/ai/stream`, {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
          "x-ynx-ai-provider": "ynx-local",
        },
        body: JSON.stringify({
          prompt: `${input.system}\n\n${input.prompt}`,
          outputLanguage: input.outputLanguage,
          attachments: [],
          maxOutputTokens: input.maxOutputTokens,
          responseFormat: input.responseFormat,
        }),
        signal: combinedSignal(input.signal, timeoutMs),
      });
    } catch (error) {
      throw modelConnectionFault(error, input.signal, "YNX hosted model");
    }
    if (!response.ok)
      throw upstreamFault(response.status, "YNX hosted model");
    const raw = await response.text();
    let text = "";
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const value = JSON.parse(line.slice(5).trim());
        if (typeof value.text === "string") text += value.text;
      } catch {}
    }
    return output(text, response.headers.get("x-ynx-ai-model") || hostedModel);
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
    if (ownerForRequest && !ownerForRequest(request)) {
      json(response, 401, { error: "A signed workspace session is required.", code: "workspace_session_required" });
      return true;
    }
    if (request.method !== "GET") {
      json(response, 405, { error: "Method not allowed.", code: "method_not_allowed" });
      return true;
    }
    json(response, 200, { ...catalog(), hosted: { ...catalog().hosted, ...(await hostedHealth()) } });
    return true;
  }

  return { protocolVersion: PROTOCOL, catalog, hostedHealth, generate, handler };
}

function validateRequest(value) {
  if (!value || typeof value !== "object")
    throw fault("Model request is required.", "invalid_model_request", 400);
  const provider = String(value.provider || "ynx-hosted").toLowerCase();
  if (provider !== "ynx-hosted" && !PROVIDERS[provider])
    throw fault("AI provider is not allowlisted.", "provider_not_allowlisted", 400);
  const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  const system = typeof value.system === "string" ? value.system.trim() : "";
  if (prompt.length < 4 || prompt.length > 96 * 1024 || system.length > 16 * 1024)
    throw fault("AI context exceeds its bounded request size.", "invalid_model_context", 400);
  const apiKey = typeof value.apiKey === "string" ? value.apiKey : "";
  if (provider !== "ynx-hosted" && (apiKey.length < 12 || apiKey.length > 512))
    throw fault("A request-only provider API key is required.", "provider_key_required", 401);
  const requestedModel = String(value.model || "").trim();
  if (requestedModel && !MODEL_PATTERN.test(requestedModel))
    throw fault("Model identifier is invalid.", "invalid_model", 400);
  return {
    provider,
    model: requestedModel || (provider === "ynx-hosted" ? "qwen3:4b" : PROVIDERS[provider].defaultModel),
    apiKey,
    prompt,
    system,
    outputLanguage: /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value.outputLanguage || "")
      ? value.outputLanguage
      : "en",
    maxOutputTokens: Math.max(128, Math.min(Number(value.maxOutputTokens || 2048), 8192)),
    responseFormat: value.responseFormat === "json" ? "json" : undefined,
    signal: isAbortSignal(value.signal) ? value.signal : undefined,
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
  return { text, model: String(model).slice(0, 120), usage };
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
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

export const MODEL_ROUTER_PROTOCOL = PROTOCOL;
