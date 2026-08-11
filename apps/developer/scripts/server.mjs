import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { Worker } from "node:worker_threads";

const root = fileURLToPath(new URL(process.env.NODE_ENV === "production" ? "../dist/" : "../", import.meta.url));
const clientRoot = fileURLToPath(new URL("../../../packages/developer-client/src/", import.meta.url));
const monacoRoot = fileURLToPath(new URL("../../../node_modules/monaco-editor/min/", import.meta.url));
const port = Number(process.env.PORT || 4176);
const releaseVersion = process.env.YNX_DEVELOPER_VERSION || "0.2.0-testnet-preview";
const sourceCommit = process.env.YNX_DEVELOPER_COMMIT || "development";
const upstreams = { "/chain": process.env.YNX_DEVELOPER_CHAIN_URL || "http://127.0.0.1:6420", "/ai-gateway": process.env.YNX_DEVELOPER_AI_URL || "http://127.0.0.1:6429", "/app-gateway": process.env.YNX_DEVELOPER_APP_GATEWAY_URL || "http://127.0.0.1:6432" };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json" };
const compilerWorker = fileURLToPath(new URL("./compiler-worker.mjs", import.meta.url));
const aiKey = process.env.YNX_DEVELOPER_AI_KEY || "";
const localAIURL = (process.env.YNX_DEVELOPER_LOCAL_AI_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const localAIModel = process.env.YNX_DEVELOPER_LOCAL_AI_MODEL || "qwen3:4b";
const aiLimits = new Map();
const managedAIState = { available: null, error: null, checkedAt: null };
let activeCompilers = 0;
const MAX_ACTIVE_COMPILERS = 4;
const compilerQueue = [];
const MAX_QUEUED_COMPILERS = 64;
let activeLocalAI = 0;
const localAIQueue = [];
const MAX_ACTIVE_LOCAL_AI = Number(process.env.YNX_DEVELOPER_LOCAL_AI_CONCURRENCY || 2);
const MAX_QUEUED_LOCAL_AI = Number(process.env.YNX_DEVELOPER_LOCAL_AI_QUEUE || 32);
const BYO_PROVIDERS = Object.freeze({
  openai: { url: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-4.1-mini" },
  xai: { url: "https://api.x.ai/v1/chat/completions", defaultModel: "grok-code-fast-1" },
});

function json(response, status, value, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  response.end(JSON.stringify(value));
}

function clientAddress(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function allowAI(request) {
  const now = Date.now(); const key = clientAddress(request); const current = aiLimits.get(key);
  if (!current || now >= current.resetAt) { aiLimits.set(key, { count: 1, resetAt: now + 60_000 }); return true; }
  if (current.count >= 10) return false;
  current.count += 1; return true;
}

createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (request.method === "GET" && (pathname === "/health" || pathname === "/version")) {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    response.end(JSON.stringify({
      ok: true,
      service: "ynx-developer-web",
      version: releaseVersion,
      commit: sourceCommit,
      network: "YNX Testnet",
      chainId: 6423,
      signingBoundary: "wallet-only",
      publicPreview: true
    }));
    return;
  }
  if (request.method === "GET" && pathname === "/compiler/compiler") {
    json(response, 200, { id: "solidity-0.8.24", compiler: "solc", version: "0.8.24", optimizerEnabled: true, optimizerRuns: 200, pinned: true, productionCompilerEnabled: true, execution: "worker-isolated-standard-json", maxSourceBytes: 524288, maxConcurrentCompilers: MAX_ACTIVE_COMPILERS, maxQueuedCompilers: MAX_QUEUED_COMPILERS, activeCompilers, queuedCompilers: compilerQueue.length });
    return;
  }
  if (request.method === "POST" && pathname === "/compiler/compile") {
    let body;
    try { body = JSON.parse((await readBody(request, 600 * 1024)).toString("utf8")); }
    catch (error) { json(response, error.status || 400, { ok: false, error: error.message || "Invalid compiler request." }); return; }
    if (typeof body.source !== "string" || body.source.length === 0 || Buffer.byteLength(body.source) > 512 * 1024 || !/pragma\s+solidity\s+(?:=\s*)?0\.8\.24\s*;/u.test(body.source)) { json(response, 400, { ok: false, error: "Compile requires source up to 512 KiB with exact pragma Solidity 0.8.24." }); return; }
    try {
      const result = await scheduleCompiler({ name: typeof body.name === "string" ? body.name.slice(0, 128) : "Contract", source: body.source });
      json(response, result.status || (result.ok ? 200 : 500), result);
    } catch (error) { json(response, error.status || 500, { ok: false, error: error.message || "Compiler worker failed." }, error.status === 503 ? { "retry-after": "2" } : {}); }
    return;
  }
  if (pathname === "/ai-build/health" && request.method === "GET") {
    try {
      const upstream = await fetch(`${localAIURL}/api/tags`, { signal: AbortSignal.timeout(2_500) });
      const value = await upstream.json();
      const installed = Array.isArray(value.models) && value.models.some((item) => item.name === localAIModel || item.model === localAIModel);
      json(response, installed ? 200 : 503, { ok: installed, available: installed, providerConfigured: installed, provider: "ynx-local-open-model", model: localAIModel, modelLicenseBoundary: "model-card-and-upstream-license-apply", managedSession: true, byoProviders: Object.keys(BYO_PROVIDERS), active: activeLocalAI, queued: localAIQueue.length, maxConcurrent: MAX_ACTIVE_LOCAL_AI, maxQueued: MAX_QUEUED_LOCAL_AI, truthfulStatus: installed ? "local-model-ready" : "local-model-missing" });
    } catch { json(response, 502, { ok: false, available: false, providerConfigured: false, error: "local_model_unavailable", provider: "ynx-local-open-model", model: localAIModel, managedSession: true }); }
    return;
  }
  if (pathname === "/ai-build/ai/stream" && request.method === "POST") {
    if (!allowAI(request)) { json(response, 429, { error: "Per-user AI limit reached. Retry in one minute." }, { "retry-after": "60" }); return; }
    const provider = String(request.headers["x-ynx-ai-provider"] || "ynx-local").toLowerCase();
    if (provider === "ynx-cloud") {
      if (!aiKey) { json(response, 503, { error: "Managed cloud AI session is not configured." }); return; }
      await proxy(request, response, upstreams["/ai-gateway"], "/ai/stream", { aiKey, onStatus(status) { managedAIState.available = status === 200; managedAIState.error = status === 429 ? "provider_rate_limited" : status === 200 ? null : "provider_unavailable"; managedAIState.checkedAt = new Date().toISOString(); } }); return;
    }
    let body;
    try { body = JSON.parse((await readBody(request, 128 * 1024)).toString("utf8")); }
    catch (error) { json(response, error.status || 400, { error: error.message || "Invalid AI request." }); return; }
    if (provider === "ynx-local") { await scheduleLocalAI(request, response, body); return; }
    if (BYO_PROVIDERS[provider]) { await runBYOAI(request, response, body, provider); return; }
    json(response, 400, { error: "AI provider is not allowlisted." }); return;
  }
  const prefix = Object.keys(upstreams).find((value) => pathname === value || pathname.startsWith(`${value}/`));
  if (prefix) { await proxy(request, response, upstreams[prefix], request.url.slice(prefix.length) || "/"); return; }
  const monacoAsset = pathname.startsWith("/monaco/");
  const developmentMonaco = monacoAsset && process.env.NODE_ENV !== "production";
  const base = pathname.startsWith("/client/") ? clientRoot : developmentMonaco ? monacoRoot : root;
  const relative = pathname.startsWith("/client/") ? pathname.slice(8) : developmentMonaco ? pathname.slice(8) : pathname === "/" ? "index.html" : pathname.slice(1);
  const target = normalize(join(base, relative));
  if (!target.startsWith(base)) { response.writeHead(403).end("Forbidden"); return; }
  try {
    if (!(await stat(target)).isFile()) throw new Error("not file");
    response.writeHead(200, { "content-type": types[extname(target)] || "application/octet-stream", "cache-control": pathname.startsWith("/monaco/") ? "public, max-age=31536000, immutable" : "no-store", "content-security-policy": "default-src 'self'; connect-src 'self' http://127.0.0.1:* https:; worker-src 'self' blob:; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" });
    response.end(await readFile(target));
  } catch { response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`YNX Developer Web http://127.0.0.1:${port}`));

async function proxy(request, response, upstream, path, { aiKey: managedAIKey, onStatus } = {}) {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 2 * 1024 * 1024) { response.writeHead(413).end("Request too large"); return; } chunks.push(chunk); }
    const headers = { accept: request.headers.accept || "application/json" };
    if (request.headers["content-type"]) headers["content-type"] = request.headers["content-type"];
    if (managedAIKey) headers["x-ynx-ai-key"] = managedAIKey;
    else if (request.headers["x-ynx-ai-key"]) headers["x-ynx-ai-key"] = request.headers["x-ynx-ai-key"];
    const result = await fetch(`${upstream.replace(/\/$/, "")}${path}`, { method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    onStatus?.(result.status);
    const outgoing = {}; for (const name of ["content-type", "cache-control", "x-request-id", "x-ynx-network", "x-ynx-truthful-status"]) { const value = result.headers.get(name); if (value) outgoing[name] = value; }
    response.writeHead(result.status, outgoing); if (result.body) Readable.fromWeb(result.body).pipe(response); else response.end();
  } catch { response.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: "Configured YNX upstream is unavailable." })); }
}

async function readBody(request, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw Object.assign(new Error("Request too large."), { status: 413 }); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

function runCompiler(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(compilerWorker, { workerData: payload });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error("Compiler timed out after 15 seconds.")); }, 15_000);
    worker.once("message", (result) => { clearTimeout(timeout); resolve(result); });
    worker.once("error", (error) => { clearTimeout(timeout); reject(error); });
    worker.once("exit", (code) => { if (code !== 0) { clearTimeout(timeout); reject(new Error(`Compiler worker exited with code ${code}.`)); } });
  });
}

function scheduleCompiler(payload) {
  if (activeCompilers >= MAX_ACTIVE_COMPILERS && compilerQueue.length >= MAX_QUEUED_COMPILERS) return Promise.reject(Object.assign(new Error("Compiler queue is full. Retry shortly."), { status: 503 }));
  return new Promise((resolve, reject) => { compilerQueue.push({ payload, resolve, reject }); pumpCompilerQueue(); });
}

function pumpCompilerQueue() {
  while (activeCompilers < MAX_ACTIVE_COMPILERS && compilerQueue.length) {
    const task = compilerQueue.shift(); activeCompilers += 1;
    runCompiler(task.payload).then(task.resolve, task.reject).finally(() => { activeCompilers -= 1; pumpCompilerQueue(); });
  }
}

function validatedAIPrompt(body) {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 4 || prompt.length > 12_000) throw Object.assign(new Error("AI prompt must be 4-12000 characters."), { status: 400 });
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (attachments.length > 64) throw Object.assign(new Error("AI attachment limit exceeded."), { status: 400 });
  let bytes = Buffer.byteLength(prompt); const parts = [prompt];
  for (const item of attachments) {
    const name = String(item?.name || "attachment").slice(0, 240);
    const content = typeof item?.text === "string" ? item.text : "";
    bytes += Buffer.byteLength(content); if (bytes > 96 * 1024) throw Object.assign(new Error("AI context exceeds 96 KiB."), { status: 413 });
    parts.push(`\n--- ${name} ---\n${content}`);
  }
  const language = String(body.outputLanguage || "en").slice(0, 16);
  return `Answer in ${language}. ${parts.join("\n")}`;
}

async function scheduleLocalAI(request, response, body) {
  if (activeLocalAI >= MAX_ACTIVE_LOCAL_AI && localAIQueue.length >= MAX_QUEUED_LOCAL_AI) { json(response, 503, { error: "Local AI queue is full. Retry shortly." }, { "retry-after": "5" }); return; }
  const controller = new AbortController(); const abort = () => controller.abort(); request.once("aborted", abort); response.once("close", () => { if (!response.writableEnded) abort(); });
  await new Promise((resolve) => { const task={ request, response, body, controller, resolve, abortQueued:null }; task.abortQueued=()=>{const index=localAIQueue.indexOf(task);if(index<0)return;localAIQueue.splice(index,1);resolve();};controller.signal.addEventListener("abort",task.abortQueued,{once:true});if(controller.signal.aborted){resolve();return;}localAIQueue.push(task);pumpLocalAIQueue(); });
}

function pumpLocalAIQueue() {
  while (activeLocalAI < MAX_ACTIVE_LOCAL_AI && localAIQueue.length) {
    const task = localAIQueue.shift(); activeLocalAI += 1;
    task.controller.signal.removeEventListener("abort",task.abortQueued);
    if(task.controller.signal.aborted){activeLocalAI-=1;task.resolve();continue;}
    runLocalAI(task.response, task.body, task.controller.signal).catch((error) => { if (task.controller.signal.aborted) return; if (!task.response.headersSent) json(task.response, error.status || 502, { error: error.message || "Local model failed." }); else task.response.end(); }).finally(() => { activeLocalAI -= 1; task.resolve(); pumpLocalAIQueue(); });
  }
}

async function runLocalAI(response, body, clientSignal) {
  const prompt = validatedAIPrompt(body);
  const maxOutputTokens = Math.max(128, Math.min(Number(body.maxOutputTokens || 2048), 8192));
  const upstream = await fetch(`${localAIURL}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: localAIModel, stream: true, think: false, keep_alive: "10m", ...(body.responseFormat === "json" ? { format: "json" } : {}), messages: [{ role: "system", content: "You are YNX Developer AI Build. Produce concise, reviewable code changes. Never claim a command ran unless tool evidence is supplied. Use ```ynx-file path=... blocks for proposed files." }, { role: "user", content: prompt }], options: { temperature: 0.2, num_ctx: 16384, num_predict: maxOutputTokens } }), signal: AbortSignal.any([clientSignal, AbortSignal.timeout(180_000)]) });
  if (!upstream.ok || !upstream.body) throw Object.assign(new Error(`Local model returned HTTP ${upstream.status}.`), { status: 502 });
  response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-ynx-ai-provider": "ynx-local-open-model", "x-ynx-ai-model": localAIModel });
  const reader = upstream.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let preamble = ""; let finalAnswerStarted = false; let visibleOutputStarted = false;
  while (true) {
    const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n"); buffer = lines.pop() || "";
    for (const line of lines) if (line.trim()) {
      const event = JSON.parse(line); const token = event.message?.content; if (!token) continue;
      if (finalAnswerStarted) { const visible = visibleOutputStarted ? token : token.replace(/^\s+/, ""); if (visible) { visibleOutputStarted = true; response.write(`data: ${JSON.stringify({ text: visible })}\n\n`); } continue; }
      preamble += token; if (preamble.length > 2 * 1024 * 1024) throw Object.assign(new Error("Local model preamble exceeded the output limit."), { status: 502 });
      const marker = preamble.indexOf("</think>");
      if (marker >= 0) { finalAnswerStarted = true; const visible = preamble.slice(marker + 8).replace(/^\s+/, ""); preamble = ""; if (visible) { visibleOutputStarted = true; response.write(`data: ${JSON.stringify({ text: visible })}\n\n`); } }
    }
  }
  if (!finalAnswerStarted && preamble.trim()) response.write(`data: ${JSON.stringify({ text: preamble })}\n\n`);
  response.end();
}

async function runBYOAI(request, response, body, provider) {
  const apiKey = String(request.headers["x-ynx-ai-key"] || "");
  if (apiKey.length < 12 || apiKey.length > 512) { json(response, 401, { error: "A session-only provider API key is required." }); return; }
  let prompt; try { prompt = validatedAIPrompt(body); } catch (error) { json(response, error.status || 400, { error: error.message }); return; }
  const spec = BYO_PROVIDERS[provider]; const requested = String(request.headers["x-ynx-ai-model"] || "").trim();
  const model = /^[A-Za-z0-9._:-]{1,120}$/.test(requested) ? requested : spec.defaultModel;
  try {
    const upstream = await fetch(spec.url, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model, stream: false, temperature: 0.2, messages: [{ role: "system", content: "You are YNX Developer AI Build. Return reviewable code and use ```ynx-file path=... blocks for proposed files." }, { role: "user", content: prompt }] }), signal: AbortSignal.timeout(120_000) });
    const value = await upstream.json().catch(() => ({})); if (!upstream.ok) { json(response, upstream.status === 429 ? 429 : 502, { error: upstream.status === 429 ? "Provider rate limit reached." : "Provider request failed.", provider }); return; }
    const output = value.choices?.[0]?.message?.content; if (typeof output !== "string" || !output.trim()) { json(response, 502, { error: "Provider returned no coding result." }); return; }
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-ynx-ai-provider": provider, "x-ynx-ai-model": model }); response.end(`data: ${JSON.stringify({ text: output })}\n\n`);
  } catch { json(response, 502, { error: "Provider connection failed." }); }
}
