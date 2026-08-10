#!/usr/bin/env node
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const [webRootValue, certificatePath, keyPath, readyPath] = process.argv.slice(2);
if (!webRootValue || !certificatePath || !keyPath || !readyPath) throw new Error("usage: https-artifact-server.mjs <web-root> <certificate> <key> <ready-output>");
const webRoot = path.resolve(webRootValue);
const server = https.createServer({
  cert: fs.readFileSync(certificatePath),
  key: fs.readFileSync(keyPath),
}, (request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "https://127.0.0.1").pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const target = path.resolve(webRoot, `.${pathname}`);
  if (!target.startsWith(`${webRoot}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    response.writeHead(404).end();
    return;
  }
  if (!stat.isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Length": stat.size,
    "Content-Type": "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  fs.createReadStream(target).pipe(response);
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  fs.writeFileSync(readyPath, `${JSON.stringify({port: address.port})}\n`, {mode: 0o600});
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
