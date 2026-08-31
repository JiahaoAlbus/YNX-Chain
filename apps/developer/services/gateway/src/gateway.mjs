import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createWorkspaceRuntime } from "../../workspace-agent/src/runtime.mjs";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const SECURITY = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' wss:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export function createGateway({
  staticRoot,
  runtime = createWorkspaceRuntime(),
  handlers = [],
  version = process.env.YNX_CODE_RELEASE || "development",
  sourceCommit = process.env.YNX_CODE_SOURCE_COMMIT || null,
  sourceTree = process.env.YNX_CODE_SOURCE_TREE || null,
}) {
  const root = resolve(staticRoot);
  const buildIdentity = exactBuildIdentity({ sourceCommit, sourceTree });
  return async function handler(request, response) {
    try {
      if (await runtime.handler(request, response)) return;
      for (const service of handlers)
        if (await service(request, response)) return;
      const url = new URL(
        request.url,
        `http://${request.headers.host || "127.0.0.1"}`,
      );
      if (url.pathname === "/healthz") {
        return sendJson(response, 200, {
          ok: true,
          service: "ynx-code-gateway",
          version,
          ...buildIdentity,
          ...runtime.status(),
        });
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        return sendJson(
          response,
          405,
          { error: "Method not allowed." },
          { allow: "GET, HEAD" },
        );
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.includes("\0") || decoded.includes("\\"))
        return sendJson(response, 400, { error: "Invalid asset path." });
      let target = safeAsset(
        root,
        decoded === "/" ? "index.html" : decoded.slice(1),
      );
      if (!target)
        return sendJson(response, 400, { error: "Invalid asset path." });
      if (!(await readableFile(target))) {
        if (!acceptsHtml(request))
          return sendJson(response, 404, { error: "Asset not found." });
        target = join(root, "index.html");
      }
      const info = await stat(target),
        extension = extname(target).toLowerCase(),
        immutable =
          target.includes(`${sep}assets${sep}`) &&
          /-[A-Za-z0-9_-]{6,}\./.test(target);
      response.writeHead(200, {
        ...SECURITY,
        "content-type": CONTENT_TYPES[extension] || "application/octet-stream",
        "content-length": info.size,
        "cache-control":
          extension === ".html"
            ? "no-cache"
            : immutable
              ? "public, max-age=31536000, immutable"
              : "public, max-age=300",
      });
      if (request.method === "HEAD") return response.end();
      createReadStream(target).pipe(response);
    } catch (error) {
      if (!response.headersSent)
        sendJson(response, 500, { error: "Gateway request failed." });
      else response.destroy(error);
    }
  };
}
function exactBuildIdentity({ sourceCommit, sourceTree }) {
  if (sourceCommit === null && sourceTree === null) return Object.freeze({ sourceCommit: null, sourceTree: null });
  if (typeof sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("YNX_CODE_SOURCE_COMMIT must be an exact lowercase Git commit.");
  if (typeof sourceTree !== "string" || !/^[0-9a-f]{40}$/.test(sourceTree)) throw new Error("YNX_CODE_SOURCE_TREE must be an exact lowercase Git tree.");
  return Object.freeze({ sourceCommit, sourceTree });
}
function safeAsset(root, path) {
  const target = normalize(join(root, path));
  return target === root || target.startsWith(`${root}${sep}`) ? target : null;
}
async function readableFile(path) {
  try {
    await access(path, fsConstants.R_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
function acceptsHtml(request) {
  return String(request.headers.accept || "").includes("text/html");
}
function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    ...SECURITY,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(value));
}
