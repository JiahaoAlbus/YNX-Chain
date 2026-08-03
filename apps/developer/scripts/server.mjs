import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { Worker } from "node:worker_threads";

const root = fileURLToPath(new URL(process.env.NODE_ENV === "production" ? "../dist/" : "../", import.meta.url));
const clientRoot = fileURLToPath(new URL("../../../packages/developer-client/src/", import.meta.url));
const port = Number(process.env.PORT || 4176);
const releaseVersion = process.env.YNX_DEVELOPER_VERSION || "0.2.0-testnet-preview";
const sourceCommit = process.env.YNX_DEVELOPER_COMMIT || "development";
const upstreams = { "/chain": process.env.YNX_DEVELOPER_CHAIN_URL || "http://127.0.0.1:6420", "/ai-gateway": process.env.YNX_DEVELOPER_AI_URL || "http://127.0.0.1:6429", "/app-gateway": process.env.YNX_DEVELOPER_APP_GATEWAY_URL || "http://127.0.0.1:6432" };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const compilerWorker = fileURLToPath(new URL("./compiler-worker.mjs", import.meta.url));
const aiKey = process.env.YNX_DEVELOPER_AI_KEY || "";
const aiLimits = new Map();
const managedAIState = { available: null, error: null, checkedAt: null };
let activeCompilers = 0;
const MAX_ACTIVE_COMPILERS = 4;
const compilerQueue = [];
const MAX_QUEUED_COMPILERS = 64;

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
      const upstream = await fetch(`${upstreams["/ai-gateway"]}/health`, { headers: { accept: "application/json" } });
      const value = await upstream.json();
      json(response, upstream.status, { ...value, available: managedAIState.available, error: managedAIState.error, managedSession: true, providerCheckedAt: managedAIState.checkedAt });
    } catch { json(response, 502, { ok: false, available: false, error: "gateway_unavailable", managedSession: true }); }
    return;
  }
  if (pathname === "/ai-build/ai/stream" && request.method === "POST") {
    if (!aiKey) { json(response, 503, { error: "Managed AI session is not configured." }); return; }
    if (!allowAI(request)) { json(response, 429, { error: "Per-user AI limit reached. Retry in one minute." }, { "retry-after": "60" }); return; }
    await proxy(request, response, upstreams["/ai-gateway"], "/ai/stream", { aiKey, onStatus(status) { managedAIState.available = status === 200; managedAIState.error = status === 429 ? "provider_rate_limited" : status === 200 ? null : "provider_unavailable"; managedAIState.checkedAt = new Date().toISOString(); } }); return;
  }
  const prefix = Object.keys(upstreams).find((value) => pathname === value || pathname.startsWith(`${value}/`));
  if (prefix) { await proxy(request, response, upstreams[prefix], request.url.slice(prefix.length) || "/"); return; }
  const base = pathname.startsWith("/client/") ? clientRoot : root;
  const relative = pathname.startsWith("/client/") ? pathname.slice(8) : pathname === "/" ? "index.html" : pathname.slice(1);
  const target = normalize(join(base, relative));
  if (!target.startsWith(base)) { response.writeHead(403).end("Forbidden"); return; }
  try {
    if (!(await stat(target)).isFile()) throw new Error("not file");
    response.writeHead(200, { "content-type": types[extname(target)] || "application/octet-stream", "cache-control": "no-store", "content-security-policy": "default-src 'self'; connect-src 'self' http://127.0.0.1:* https:; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" });
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
