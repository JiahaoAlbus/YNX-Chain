import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createEnvironmentService } from "../src/service.mjs";

test("environment is revision guarded, owner isolated, and survives restart", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-environment-test-")),
    filename = join(root, "environment.sqlite");
  t.after(() => rm(root, { recursive: true, force: true }));
  let service = createEnvironmentService({
    filename,
    ownerForRequest: (request) => request.headers["x-owner"] || null,
  });
  const saved = service.put("owner-a", "project-a", {
    protocolVersion: "ynx-code-environment/v1",
    approval: "update-environment-once",
    expectedRevision: 0,
    entries: [
      { key: "PUBLIC_ORIGIN", kind: "literal", value: "https://example.test" },
      {
        key: "API_TOKEN",
        kind: "secret-reference",
        reference: "vault://developer/api-token",
      },
    ],
  });
  assert.equal(saved.revision, 1);
  assert.deepEqual(service.get("owner-b", "project-a").entries, []);
  assert.throws(
    () =>
      service.put("owner-a", "project-a", {
        protocolVersion: "ynx-code-environment/v1",
        approval: "update-environment-once",
        expectedRevision: 0,
        entries: [],
      }),
    (error) => error.code === "environment_revision_conflict",
  );
  service.close();
  service = createEnvironmentService({ filename, ownerForRequest: () => null });
  t.after(() => service.close());
  assert.equal(service.get("owner-a", "project-a").entries.find((entry) => entry.key === "API_TOKEN").reference, "vault://developer/api-token");
});

test("resolution fails closed without a Secret broker and never changes the public record", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-environment-secret-test-")),
    filename = join(root, "environment.sqlite"),
    secret = "resolved-value-never-returned";
  t.after(() => rm(root, { recursive: true, force: true }));
  const unavailable = createEnvironmentService({
    filename,
    ownerForRequest: () => null,
  });
  unavailable.put("owner-a", "project-a", {
    protocolVersion: "ynx-code-environment/v1",
    approval: "update-environment-once",
    expectedRevision: 0,
    entries: [{ key: "TOKEN", kind: "secret-reference", reference: "broker/token" }],
  });
  await assert.rejects(unavailable.resolve("owner-a", "project-a"), (error) => error.code === "secret_resolver_unavailable");
  unavailable.close();
  const service = createEnvironmentService({
    filename,
    ownerForRequest: (request) => request.headers["x-owner"] || null,
    secretResolver: async (value) => (value.reference === "broker/token" ? secret : null),
  });
  t.after(() => service.close());
  assert.equal((await service.resolve("owner-a", "project-a")).environment.TOKEN, secret);
  assert.equal(JSON.stringify(service.get("owner-a", "project-a")).includes(secret), false);
});

test("HTTP contract rejects reserved keys and does not cross owners", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-environment-http-test-")),
    service = createEnvironmentService({
      filename: join(root, "environment.sqlite"),
      ownerForRequest: (request) => request.headers["x-owner"] || null,
    }),
    server = createServer((request, response) =>
      service.handler(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      }),
    );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    service.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`,
    body = {
      protocolVersion: "ynx-code-environment/v1",
      approval: "update-environment-once",
      expectedRevision: 0,
      entries: [{ key: "PATH", kind: "literal", value: "/tmp/bin" }],
    };
  const rejected = await fetch(`${base}/runtime/projects/project-a/environment`, {
    method: "PUT",
    headers: { "x-owner": "owner-a", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, "invalid_environment_key");
  const other = await fetch(`${base}/runtime/projects/project-a/environment`, {
    headers: { "x-owner": "owner-b" },
  });
  assert.deepEqual((await other.json()).environment.entries, []);
});
