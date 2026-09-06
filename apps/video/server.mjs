import {createServer, request} from "node:http";
import {readFile} from "node:fs/promises";
import {extname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const csp = "default-src 'self'; connect-src 'self' https://wallet-auth.ynxweb4.com; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const publicFiles = new Set([
  "index.html", "app.js", "video-api.js", "watch-progress.js", "styles.css", "responsive.css", "i18n.js", "i18n/catalog.json", "assets/ynx-logo.svg",
  "wallet-connection.js", "product-session.js", "product-session-sdk.js", "product-session-registry.json", "product-session-sdk-source.json",
  "wallet-callback.html", "wallet-callback.js", "callback.css", "runtime-manifest.json",
  "ynx-dapp-connect-sdk/constants.js", "ynx-dapp-connect-sdk/discovery.js", "ynx-dapp-connect-sdk/errors.js", "ynx-dapp-connect-sdk/manifest.json", "ynx-dapp-connect-sdk/provider.js",
]);
// Local development can use an SSH tunnel to the real API. Production Caddy
// handles this route first; direct Viewer access can explicitly target 6493.
const apiOrigin = new URL(process.env.YNX_VIDEO_API_ORIGIN || "http://127.0.0.1:8423");
if (apiOrigin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(apiOrigin.hostname) ||
    apiOrigin.username || apiOrigin.password || apiOrigin.pathname !== "/" || apiOrigin.search || apiOrigin.hash) {
  throw new Error("YNX_VIDEO_API_ORIGIN must be a loopback HTTP origin");
}
function endToEndHeaders(headers) {
  const omitted = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host"]);
  for (const field of String(headers.connection || "").split(",")) omitted.add(field.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !omitted.has(key.toLowerCase())));
}
function proxyAPI(req, res, url) {
  const upstream = new URL(apiOrigin);
  upstream.pathname = url.pathname.slice("/video/api".length);
  upstream.search = url.search;
  const outgoing = request(upstream, {method: req.method, headers: endToEndHeaders(req.headers)}, incoming => {
    res.writeHead(incoming.statusCode, endToEndHeaders(incoming.headers));
    incoming.on("error", () => res.destroy());
    incoming.pipe(res);
  });
  outgoing.setTimeout(15000, () => outgoing.destroy(new Error("API timeout")));
  outgoing.on("error", () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(503, {"Content-Type": "application/json", "Cache-Control": "no-store"});
    res.end(JSON.stringify({error: "VIDEO_API_UNAVAILABLE"}));
  });
  req.on("aborted", () => outgoing.destroy());
  res.on("close", () => { if (!res.writableEnded) outgoing.destroy(); });
  req.pipe(outgoing);
}

createServer(async (req, res) => {
  let url, requested;
  try {
    url = new URL(req.url, "http://127.0.0.1");
    requested = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end("Invalid request path");
    return;
  }
  if (url.pathname.startsWith("/video/api/")) {
    proxyAPI(req, res, url);
    return;
  }
  // Relative modules and assets must remain beneath /video/ at the public router.
  if (requested === "/video") {
    res.writeHead(308, {Location: `/video/${url.search}`}).end();
    return;
  }
  const pathname = requested.startsWith("/video/") ? requested.slice(6) : requested;
  const path = pathname === "/" ? "index.html" : pathname === "/wallet-auth/callback" ? "wallet-callback.html" : pathname.slice(1);
  if (path.includes("..")) {
    res.writeHead(400).end();
    return;
  }
  if (!publicFiles.has(path) || !["GET", "HEAD"].includes(req.method)) {
    res.writeHead(404).end("Not found");
    return;
  }
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": csp,
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(Number(process.env.PORT || 4173), "127.0.0.1", () => console.log(`YNX Video http://127.0.0.1:${process.env.PORT || 4173}`));
