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
  const owner = runtime.ownerForRequest({ headers: { cookie } });
  assert.ok(owner);
  assert.equal((await git.runForOwner(owner, "git-project")).initialized, false);
  await assert.rejects(
    git.runForOwner("", "git-project"),
    (error) => error.code === "workspace_owner_required",
  );
  await assert.rejects(
    git.runForOwner(owner, "../other"),
    (error) => error.code === "invalid_project",
  );
  const committed = await git.runForOwner(owner, "git-project", {
    protocolVersion: "ynx-code-git-v1",
    action: "commit-reviewed",
    expectedRevision: 1,
    expectedInitialized: false,
    expectedHead: null,
    expectedBranch: null,
    paths: ["src/main.cpp"],
    message: "Initial reviewed source",
    authorName: "YNX Tester",
    authorEmail: "tester@ynx.local",
  });
  assert.equal(committed.commits.length, 1);
  assert.equal(committed.changes.length, 0);
  await assert.rejects(
    git.runForOwner(owner, "git-project", {
      protocolVersion: "ynx-code-git-v1",
      action: "commit-reviewed",
      expectedRevision: 1,
      expectedInitialized: false,
      expectedHead: null,
      expectedBranch: null,
      paths: ["src/main.cpp"],
      message: "Stale commit",
      authorName: "YNX Tester",
      authorEmail: "tester@ynx.local",
    }),
    (error) => error.code === "git_preview_stale",
  );
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
  const secondCommit = await (
    await call({
      action: "commit",
      message: "Update main",
      authorName: "YNX Tester",
      authorEmail: "tester@ynx.local",
    })
  ).json();
  assert.equal(secondCommit.commits.length, 2);
  const branched = await (
    await call({ action: "create-branch", branch: "feature/runtime" })
  ).json();
  assert.deepEqual(
    branched.branches.map((branch) => branch.name).sort(),
    ["feature/runtime", "main"],
  );
  const checkedOut = await (
    await call({
      action: "checkout",
      branch: "feature/runtime",
      expectedRevision: 2,
      idempotencyKey: "git-checkout-feature-0001",
    })
  ).json();
  assert.equal(checkedOut.branch, "feature/runtime");
  assert.equal(checkedOut.workspace.revision, 3);
  const replayedCheckout = await (
    await call({
      action: "checkout",
      branch: "feature/runtime",
      expectedRevision: 2,
      idempotencyKey: "git-checkout-feature-0001",
    })
  ).json();
  assert.equal(replayedCheckout.workspace.revision, 3);
  assert.equal(replayedCheckout.workspace.replayed, true);
  const featureWorkspace = {
    ...workspace,
    files: { "src/main.cpp": "int main(){return 3;}\n" },
  };
  const featureSaved = await fetch(`${base}/runtime/workspaces/git-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 3,
      idempotencyKey: "git-workspace-feature-0001",
      workspace: featureWorkspace,
    }),
  });
  assert.equal(featureSaved.status, 200);
  await call({ action: "stage", paths: ["src/main.cpp"] });
  const featureCommit = await (
    await call({
      action: "commit",
      message: "Feature source",
      authorName: "YNX Tester",
      authorEmail: "tester@ynx.local",
    })
  ).json();
  assert.equal(featureCommit.branch, "feature/runtime");
  const mainCheckout = await (
    await call({
      action: "checkout",
      branch: "main",
      expectedRevision: 4,
      idempotencyKey: "git-checkout-main-0001",
    })
  ).json();
  assert.equal(mainCheckout.workspace.revision, 5);
  const mainWorkspace = await (
    await fetch(`${base}/runtime/workspaces/git-project`, { headers: { cookie } })
  ).json();
  assert.equal(mainWorkspace.workspace.files["src/main.cpp"], "int main(){return 2;}\n");
  const merged = await (
    await call({
      action: "merge",
      branch: "feature/runtime",
      expectedRevision: 5,
      idempotencyKey: "git-merge-feature-0001",
      authorName: "YNX Tester",
      authorEmail: "tester@ynx.local",
    })
  ).json();
  assert.equal(merged.branch, "main", JSON.stringify(merged));
  assert.equal(merged.workspace.revision, 6);
  assert.match(merged.commits[0].subject, /Merge branch 'feature\/runtime'/);
  const mergedWorkspace = await (
    await fetch(`${base}/runtime/workspaces/git-project`, { headers: { cookie } })
  ).json();
  assert.equal(mergedWorkspace.workspace.files["src/main.cpp"], "int main(){return 3;}\n");
  const unapprovedDelete = await call({
    action: "delete-branch",
    branch: "feature/runtime",
  });
  assert.equal(unapprovedDelete.status, 403);
  const deleted = await (
    await call({
      action: "delete-branch",
      branch: "feature/runtime",
      approval: "delete-branch-once",
    })
  ).json();
  assert.deepEqual(deleted.branches.map((branch) => branch.name), ["main"]);
  const previewBody = {
    action: "remote-preview",
    operation: "create-pr",
    remoteUrl: "https://github.com/ynx/chain.git",
    branch: "main",
    targetBranch: "main",
  };
  const preview = await (await call(previewBody)).json(),
    replayedPreview = await (await call(previewBody)).json();
  assert.equal(preview.executable, false);
  assert.equal(preview.boundary, "server-side-credential-broker-required");
  assert.equal(preview.previewDigest, replayedPreview.previewDigest);
  const rejectedRemote = await call({
    ...previewBody,
    remoteUrl: "http://127.0.0.1/private.git",
  });
  assert.equal(rejectedRemote.status, 400);
  assert.equal((await rejectedRemote.json()).code, "invalid_git_remote_url");
  await call({ action: "create-branch", branch: "conflict/source" });
  await call({
    action: "checkout",
    branch: "conflict/source",
    expectedRevision: 6,
    idempotencyKey: "git-checkout-conflict-0001",
  });
  await fetch(`${base}/runtime/workspaces/git-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 7,
      idempotencyKey: "git-workspace-conflict-0001",
      workspace: {
        ...workspace,
        files: { "src/main.cpp": "int main(){return 4;}\n" },
      },
    }),
  });
  await call({ action: "stage", paths: ["src/main.cpp"] });
  await call({
    action: "commit",
    message: "Conflicting feature",
    authorName: "YNX Tester",
    authorEmail: "tester@ynx.local",
  });
  await call({
    action: "checkout",
    branch: "main",
    expectedRevision: 8,
    idempotencyKey: "git-checkout-main-0002",
  });
  await fetch(`${base}/runtime/workspaces/git-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 9,
      idempotencyKey: "git-workspace-main-0003",
      workspace: {
        ...workspace,
        files: { "src/main.cpp": "int main(){return 5;}\n" },
      },
    }),
  });
  await call({ action: "stage", paths: ["src/main.cpp"] });
  await call({
    action: "commit",
    message: "Conflicting main",
    authorName: "YNX Tester",
    authorEmail: "tester@ynx.local",
  });
  const conflicted = await call({
    action: "merge",
    branch: "conflict/source",
    expectedRevision: 10,
    idempotencyKey: "git-merge-conflict-0001",
    authorName: "YNX Tester",
    authorEmail: "tester@ynx.local",
  });
  assert.equal(conflicted.status, 409);
  const conflictBody = await conflicted.json();
  assert.equal(conflictBody.code, "git_merge_conflict");
  assert.deepEqual(conflictBody.details.conflicts, ["src/main.cpp"]);
  const afterConflict = await (
    await fetch(`${base}/runtime/workspaces/git-project`, { headers: { cookie } })
  ).json();
  assert.equal(afterConflict.workspace.revision, 10);
  assert.equal(afterConflict.workspace.files["src/main.cpp"], "int main(){return 5;}\n");
  const cleanAfterConflict = await (
    await fetch(`${base}/runtime/git/git-project`, { headers: { cookie } })
  ).json();
  assert.equal(cleanAfterConflict.branch, "main");
  assert.deepEqual(cleanAfterConflict.changes, []);
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
