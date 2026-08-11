import assert from "node:assert/strict";
import test from "node:test";
import { createModelRouter } from "../src/router.mjs";

const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "content-type": "application/json", ...(init.headers || {}) },
  ...init,
});

test("provider adapters use fixed endpoints and never return request-only keys", async () => {
  const seen = [];
  const router = createModelRouter({
    hostedBaseURL: "http://127.0.0.1:18111/ai-build",
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : null });
      if (String(url).includes("openai.com")) return jsonResponse({ model: "gpt-test", output_text: "openai-ok", usage: { input_tokens: 1, output_tokens: 2 } });
      if (String(url).includes("anthropic.com")) return jsonResponse({ model: "claude-test", content: [{ type: "text", text: "claude-ok" }], usage: { input_tokens: 3, output_tokens: 4 } });
      if (String(url).includes("googleapis.com")) return jsonResponse({ modelVersion: "gemini-test", candidates: [{ content: { parts: [{ text: "gemini-ok" }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 } });
      if (String(url).includes("api.x.ai")) return jsonResponse({ model: "grok-test", choices: [{ message: { content: "grok-ok" } }], usage: { prompt_tokens: 7, completion_tokens: 8 } });
      throw new Error("unexpected URL");
    },
  });
  const apiKey = "secret-provider-key-never-persist";
  for (const provider of ["openai", "anthropic", "google", "xai"]) {
    const result = await router.generate({ provider, apiKey, system: "Act as a bounded coding agent.", prompt: "Plan this exact change." });
    assert.match(result.text, /ok$/);
    assert.equal(result.credentialPersisted, false);
    assert.equal(JSON.stringify(result).includes(apiKey), false);
  }
  assert.equal(seen[0].url, "https://api.openai.com/v1/responses");
  assert.equal(seen[0].body.store, false);
  assert.equal(seen[1].url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen[1].init.headers["anthropic-version"], "2023-06-01");
  assert.equal(seen[2].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  assert.equal(seen[2].init.headers["x-goog-api-key"], apiKey);
  assert.equal(seen[3].url, "https://api.x.ai/v1/chat/completions");
  assert.throws(() => createModelRouter({ hostedBaseURL: "https://attacker.example" }), /loopback/);
});

test("hosted adapter parses bounded SSE and reports live capacity", async () => {
  const router = createModelRouter({
    hostedBaseURL: "http://127.0.0.1:18111/ai-build",
    fetchImpl: async (url) => String(url).endsWith("/health")
      ? jsonResponse({ available: true, provider: "ynx-local-open-model", model: "qwen3:4b", active: 1, queued: 2 })
      : new Response('data: {"text":"hello "}\n\ndata: {"text":"world"}\n\n', { status: 200, headers: { "content-type": "text/event-stream", "x-ynx-ai-model": "qwen3:4b" } }),
  });
  const health = await router.hostedHealth();
  assert.deepEqual(health, { available: true, provider: "ynx-local-open-model", model: "qwen3:4b", active: 1, queued: 2 });
  const result = await router.generate({ provider: "ynx-hosted", system: "Review code.", prompt: "Review this file." });
  assert.equal(result.text, "hello world");
  assert.equal(result.model, "qwen3:4b");
});

test("queue is bounded and invalid providers and credentials fail closed", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const router = createModelRouter({
    hostedBaseURL: "http://127.0.0.1:18111/ai-build",
    maxConcurrent: 1,
    maxQueued: 1,
    fetchImpl: async () => { await gate; return new Response('data: {"text":"ok"}\n\n', { status: 200 }); },
  });
  const first = router.generate({ provider: "ynx-hosted", system: "", prompt: "first prompt" });
  const second = router.generate({ provider: "ynx-hosted", system: "", prompt: "second prompt" });
  await assert.rejects(router.generate({ provider: "ynx-hosted", system: "", prompt: "third prompt" }), (error) => error.code === "model_queue_full");
  assert.throws(() => router.generate({ provider: "evil", system: "", prompt: "valid prompt" }), (error) => error.code === "provider_not_allowlisted");
  assert.throws(() => router.generate({ provider: "openai", system: "", prompt: "valid prompt", apiKey: "short" }), (error) => error.code === "provider_key_required");
  release();
  await Promise.all([first, second]);
});

test("client cancellation removes queued work and releases running capacity", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const router = createModelRouter({
    hostedBaseURL: "http://127.0.0.1:18111/ai-build",
    maxConcurrent: 1,
    maxQueued: 2,
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls === 1) {
        await firstGate;
        return new Response('data: {"text":"first"}\n\n', { status: 200 });
      }
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    },
  });

  const first = router.generate({ provider: "ynx-hosted", prompt: "first prompt" });
  const queuedController = new AbortController();
  const queued = router.generate({ provider: "ynx-hosted", prompt: "queued prompt", signal: queuedController.signal });
  assert.equal(router.catalog().queued, 1);
  queuedController.abort();
  await assert.rejects(queued, (error) => error.code === "model_request_cancelled" && error.status === 499);
  assert.equal(router.catalog().queued, 0);

  releaseFirst();
  await first;
  const runningController = new AbortController();
  const running = router.generate({ provider: "ynx-hosted", prompt: "running prompt", signal: runningController.signal });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(router.catalog().active, 1);
  runningController.abort();
  await assert.rejects(running, (error) => error.code === "model_request_cancelled" && error.status === 499);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(router.catalog().active, 0);
});
