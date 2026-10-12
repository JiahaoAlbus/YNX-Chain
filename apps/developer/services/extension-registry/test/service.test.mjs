import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
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
  assert.equal(installed.extension.enabled, true);
  assert.equal(installed.extension.source, "local-manifest");
  assert.equal(installed.extension.trust, "validated-declarative-only");
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
  const disabledResponse = await fetch(`${base}/runtime/extensions`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: "ynx-code-extension/v1",
        id: "ynx-labs.cpp-productivity",
        expectedDigest: installed.extension.digest,
        enabled: false,
      }),
    }),
    disabled = await disabledResponse.json();
  assert.equal(disabledResponse.status, 200);
  assert.equal(disabled.extension.enabled, false);
  const staleToggle = await fetch(`${base}/runtime/extensions`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code-extension/v1",
      id: "ynx-labs.cpp-productivity",
      expectedDigest: "0".repeat(64),
      enabled: true,
    }),
  });
  assert.equal(staleToggle.status, 409);
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
  const unapproved = await fetch(
    `${base}/runtime/extensions?id=ynx-labs.cpp-productivity`,
    { method: "DELETE", headers: { cookie } },
  );
  assert.equal(unapproved.status, 403);
  const removed = await fetch(
    `${base}/runtime/extensions?id=ynx-labs.cpp-productivity&expectedDigest=${installed.extension.digest}&approval=uninstall-extension-once`,
    { method: "DELETE", headers: { cookie } },
  );
  assert.equal(removed.status, 200);
  const empty = await (
    await fetch(`${base}/runtime/extensions`, { headers: { cookie } })
  ).json();
  assert.deepEqual(empty.extensions, []);
});

test("extension registry migrates pre-lifecycle databases as enabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "ynx-extension-migration-")),
    filename = join(root, "extensions.sqlite"),
    legacy = new DatabaseSync(filename);
  legacy.exec(
    "CREATE TABLE extensions(owner_id TEXT NOT NULL, extension_id TEXT NOT NULL, version TEXT NOT NULL, digest TEXT NOT NULL, manifest TEXT NOT NULL, installed_at TEXT NOT NULL, PRIMARY KEY(owner_id,extension_id));",
  );
  legacy.prepare(
    "INSERT INTO extensions(owner_id,extension_id,version,digest,manifest,installed_at) VALUES(?,?,?,?,?,?)",
  ).run(
    "legacy-owner",
    "ynx-labs.legacy-theme",
    "1.0.0",
    "a".repeat(64),
    JSON.stringify({
      apiVersion: "ynx-code-extension/v1",
      kind: "declarative-web",
      publisher: "ynx-labs",
      name: "legacy-theme",
      displayName: "Legacy Theme",
      version: "1.0.0",
      contributes: { languages: [], snippets: [], themes: [] },
    }),
    "2026-08-13T00:00:00.000Z",
  );
  legacy.close();
  const registry = createExtensionRegistry({
      filename,
      ownerForRequest: () => "legacy-owner",
    }),
    request = { method: "GET", url: "/runtime/extensions", headers: {} },
    response = captureResponse();
  assert.equal(await registry.handler(request, response), true);
  assert.equal(response.status, 200);
  assert.equal(response.value.extensions[0].enabled, true);
  registry.close();
});

function captureResponse() {
  return {
    status: 0,
    value: undefined,
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.value = JSON.parse(body);
    },
  };
}
