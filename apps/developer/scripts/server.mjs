import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const root = fileURLToPath(new URL("../", import.meta.url));
const clientRoot = fileURLToPath(new URL("../../../packages/developer-client/src/", import.meta.url));
const port = Number(process.env.PORT || 4176);
const upstreams = { "/chain": process.env.YNX_DEVELOPER_CHAIN_URL || "http://127.0.0.1:6420", "/ai-gateway": process.env.YNX_DEVELOPER_AI_URL || "http://127.0.0.1:6429", "/app-gateway": process.env.YNX_DEVELOPER_APP_GATEWAY_URL || "http://127.0.0.1:6432" };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
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

async function proxy(request, response, upstream, path) {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 2 * 1024 * 1024) { response.writeHead(413).end("Request too large"); return; } chunks.push(chunk); }
    const headers = { accept: request.headers.accept || "application/json" };
    if (request.headers["content-type"]) headers["content-type"] = request.headers["content-type"];
    if (request.headers["x-ynx-ai-key"]) headers["x-ynx-ai-key"] = request.headers["x-ynx-ai-key"];
    const result = await fetch(`${upstream.replace(/\/$/, "")}${path}`, { method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    const outgoing = {}; for (const name of ["content-type", "cache-control", "x-request-id", "x-ynx-network", "x-ynx-truthful-status"]) { const value = result.headers.get(name); if (value) outgoing[name] = value; }
    response.writeHead(result.status, outgoing); if (result.body) Readable.fromWeb(result.body).pipe(response); else response.end();
  } catch { response.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: "Configured YNX upstream is unavailable." })); }
}
