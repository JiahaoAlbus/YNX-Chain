import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = normalize(join(process.cwd(), "dist"));
const types = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  let target = normalize(join(root, pathname === "/" ? "index.html" : pathname));
  if (!target.startsWith(root) || !existsSync(target) || statSync(target).isDirectory()) {
    target = join(root, "index.html");
  }
  response.setHeader("Content-Type", types[extname(target)] ?? "application/octet-stream");
  response.setHeader("Cache-Control", "no-store");
  createReadStream(target).pipe(response);
}).listen(4173, "127.0.0.1");
