import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createWorkspaceRuntime } from "../../workspace-agent/src/runtime.mjs";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createGitService } from "../src/service.mjs";

test("Git broker isolates a real persistent object database and supports stage, commit and diff", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-git-test-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    runtime = createWorkspaceRuntime({
      sessionKey: "git-test-session-key-that-is-long-enough",
      workspaceStore: store,
    }),
    git = createGitService({
      workspaceStore: store,
      ownerForRequest: (request) => runtime.ownerForRequest(request),
      root: join(root, "repositories"),
    }),
    server = createServer(async (request, response) => {
      if (await runtime.handler(request, response)) return;
      if (await git.handler(request, response)) return;
      response.statusCode = 404;
      response.end();
    });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const address = server.address(),
    base = `http://127.0.0.1:${address.port}`,
    health = await fetch(`${base}/runtime/health`),
    cookie = health.headers.get("set-cookie")?.split(";")[0],
    workspace = {
      name: "Git Project",
      folders: ["src"],
      files: { "src/main.cpp": "int main(){return 1;}\n" },
      open: ["src/main.cpp"],
      active: "src/main.cpp",
    };
  await fetch(`${base}/runtime/workspaces/git-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 0,
      idempotencyKey: "git-workspace-0001",
      workspace,
    }),
  });
  const call = (body) =>
    fetch(`${base}/runtime/git/git-project`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: "ynx-code-git-v1", ...body }),
    });
  assert.equal(
    (
      await (
        await fetch(`${base}/runtime/git/git-project`, { headers: { cookie } })
      ).json()
    ).initialized,
    false,
  );
  const initialized = await (await call({ action: "init" })).json();
  assert.equal(initialized.initialized, true);
  await call({ action: "stage", paths: ["src/main.cpp"] });
  const committed = await (
    await call({
      action: "commit",
      message: "Initial source",
      authorName: "YNX Tester",
      authorEmail: "tester@ynx.local",
    })
  ).json();
  assert.equal(committed.commits.length, 1);
  assert.equal(committed.changes.length, 0);
  await fetch(`${base}/runtime/workspaces/git-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 1,
      idempotencyKey: "git-workspace-0002",
      workspace: {
        ...workspace,
        files: { "src/main.cpp": "int main(){return 2;}\n" },
      },
    }),
  });
  const changed = await (
    await fetch(`${base}/runtime/git/git-project`, { headers: { cookie } })
  ).json();
  assert.equal(changed.changes[0].worktreeStatus, "M");
  const diff = await (
    await fetch(
      `${base}/runtime/git/git-project?view=diff&path=src%2Fmain.cpp`,
      { headers: { cookie } },
    )
  ).json();
  assert.match(diff.diff, /\+int main\(\)\{return 2;\}/);
  await call({ action: "stage", paths: ["src/main.cpp"] });
  const staged = await (
    await fetch(`${base}/runtime/git/git-project`, { headers: { cookie } })
  ).json();
  assert.equal(staged.changes[0].indexStatus, "M");
  const otherHealth = await fetch(`${base}/runtime/health`),
    otherCookie = otherHealth.headers.get("set-cookie")?.split(";")[0];
  await fetch(`${base}/runtime/workspaces/git-project`, {
    method: "PUT",
    headers: { cookie: otherCookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 0,
      idempotencyKey: "other-owner-0001",
      workspace,
    }),
  });
  const isolated = await (
    await fetch(`${base}/runtime/git/git-project`, {
      headers: { cookie: otherCookie },
    })
  ).json();
  assert.equal(isolated.initialized, false);
});
