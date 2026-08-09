import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createWorkspaceRuntime } from "../../workspace-agent/src/runtime.mjs";
import { createExtensionRegistry } from "../src/service.mjs";

test("declarative extension registry validates, digests, persists and isolates manifests", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-extension-test-")),
    runtime = createWorkspaceRuntime({
      sessionKey: "extension-test-session-key-that-is-long-enough",
    }),
    registry = createExtensionRegistry({
      filename: join(root, "extensions.sqlite"),
      ownerForRequest: (request) => runtime.ownerForRequest(request),
    }),
    server = createServer(async (request, response) => {
      if (await runtime.handler(request, response)) return;
      if (await registry.handler(request, response)) return;
      response.statusCode = 404;
      response.end();
    });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    registry.close();
  });
  const address = server.address(),
    base = `http://127.0.0.1:${address.port}`,
    health = await fetch(`${base}/runtime/health`),
    cookie = health.headers.get("set-cookie")?.split(";")[0],
    manifest = {
      apiVersion: "ynx-code-extension/v1",
      kind: "declarative-web",
      publisher: "ynx-labs",
      name: "cpp-productivity",
      displayName: "C++ Productivity",
      version: "1.0.0",
      description: "Reviewed snippets and theme.",
      contributes: {
        languages: [
          { id: "cpp", extensions: [".cpp", ".hpp"], aliases: ["C++"] },
        ],
        snippets: [
          {
            language: "cpp",
            label: "main function",
            prefix: "main",
            body: ["int main() {", "  ${1:return 0;}", "}"],
          },
        ],
        themes: [
          {
            id: "midnight",
            label: "Midnight",
            type: "dark",
            colors: { background: "#101114", accent: "#315DB4" },
          },
        ],
      },
    };
  const install = await fetch(`${base}/runtime/extensions`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: "ynx-code-extension/v1",
        manifest,
      }),
    }),
    installed = await install.json();
  assert.equal(install.status, 200);
  assert.match(installed.extension.digest, /^[a-f0-9]{64}$/);
  const replayed = await (
    await fetch(`${base}/runtime/extensions`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: "ynx-code-extension/v1",
        manifest,
      }),
    })
  ).json();
  assert.equal(replayed.replayed, true);
  const listed = await (
    await fetch(`${base}/runtime/extensions`, { headers: { cookie } })
  ).json();
  assert.equal(
    listed.extensions[0].manifest.contributes.snippets[0].prefix,
    "main",
  );
  const invalid = await fetch(`${base}/runtime/extensions`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code-extension/v1",
      manifest: {
        ...manifest,
        kind: "runtime-code",
        contributes: { scripts: ["process.js"] },
      },
    }),
  });
  assert.equal(invalid.status, 400);
  const other = await fetch(`${base}/runtime/health`),
    otherCookie = other.headers.get("set-cookie")?.split(";")[0],
    isolated = await (
      await fetch(`${base}/runtime/extensions`, {
        headers: { cookie: otherCookie },
      })
    ).json();
  assert.equal(isolated.extensions.length, 0);
  const removed = await fetch(
    `${base}/runtime/extensions?id=ynx-labs.cpp-productivity`,
    { method: "DELETE", headers: { cookie } },
  );
  assert.equal(removed.status, 200);
});
