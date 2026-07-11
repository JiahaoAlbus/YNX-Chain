#!/usr/bin/env node
import http from "node:http";

const port = Number(process.env.YNX_FAKE_AI_PROVIDER_PORT || 6430);
const expectedKey = process.env.YNX_FAKE_AI_PROVIDER_KEY || "local-provider-key";

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/chat/completions") {
    res.writeHead(404).end("not found");
    return;
  }
  if (req.headers.authorization !== `Bearer ${expectedKey}` || !req.headers["x-request-id"]) {
    res.writeHead(401).end("unauthorized");
    return;
  }
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 2 * 1024 * 1024) req.destroy();
  });
  req.on("end", () => {
    try {
      const input = JSON.parse(body);
      const messages = Array.isArray(input.messages) ? input.messages : [];
      const user = messages.findLast((message) => message.role === "user")?.content;
      const context = messages.filter((message) => message.role === "system").at(-1)?.content;
      if (!input.model || !user || !context) throw new Error("missing model, user, or chain context");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: `verified provider answer for ${user}; ${context}` } }] }));
    } catch (error) {
      res.writeHead(400).end(String(error));
    }
  });
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`fake AI provider listening on ${port}\n`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
