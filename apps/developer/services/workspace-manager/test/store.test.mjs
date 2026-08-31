import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createWorkspaceStore } from "../src/store.mjs";

const payload = {
  name: "C++ Project",
  folders: ["src"],
  files: { "src/main.cpp": "int main(){return 0;}" },
  open: ["src/main.cpp"],
  active: "src/main.cpp",
};

test("workspace store persists revisions, isolates owners and replays idempotently", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-workspace-store-")),
    filename = join(root, "workspaces.sqlite");
  t.after(() => rm(root, { recursive: true, force: true }));
  let store = createWorkspaceStore({ filename });
  const created = store.put("owner-a", "project-a", {
    expectedRevision: 0,
    idempotencyKey: "mutation-0001",
    payload,
  });
  assert.equal(created.revision, 1);
  assert.equal(store.get("owner-b", "project-a"), null);
  assert.equal(
    store.put("owner-a", "project-a", {
      expectedRevision: 0,
      idempotencyKey: "mutation-0001",
      payload,
    }).replayed,
    true,
  );
  assert.throws(
    () =>
      store.put("owner-a", "project-a", {
        expectedRevision: 0,
        idempotencyKey: "mutation-0002",
        payload,
      }),
    (error) => error.code === "revision_conflict" && error.currentRevision === 1,
  );
  assert.equal(store.history("owner-a", "project-a").revisions[0].revision, 1);
  assert.equal(store.history("owner-b", "project-a").revisions.length, 0);
  store.close();
  store = createWorkspaceStore({ filename });
  assert.equal(
    store.get("owner-a", "project-a").files["src/main.cpp"],
    payload.files["src/main.cpp"],
  );
  assert.equal(store.snapshot("owner-a", "project-a", 1).source, "mutation");
  store.close();
});

test("workspace restore is revision guarded, one-time approved, idempotent and durable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-workspace-restore-")),
    filename = join(root, "workspaces.sqlite"),
    approvalId = randomUUID(),
    restoreRequest = {
      expectedRevision: 2,
      sourceRevision: 1,
      idempotencyKey: "restore-request-0001",
      approvalId,
    };
  t.after(() => rm(root, { recursive: true, force: true }));
  let store = createWorkspaceStore({ filename });
  store.put("owner", "project", {
    expectedRevision: 0,
    idempotencyKey: "restore-source-0001",
    payload,
  });
  store.put("owner", "project", {
    expectedRevision: 1,
    idempotencyKey: "restore-source-0002",
    payload: {
      ...payload,
      files: { "src/main.cpp": "int main(){return 2;}" },
    },
  });
  assert.deepEqual(
    store.history("owner", "project").revisions.map((item) => item.revision),
    [2, 1],
  );
  assert.throws(
    () =>
      store.restore("owner", "project", {
        ...restoreRequest,
        expectedRevision: 1,
      }),
    (error) => error.code === "revision_conflict" && error.currentRevision === 2,
  );
  const restored = store.restore("owner", "project", restoreRequest);
  assert.equal(restored.revision, 3);
  assert.equal(restored.restoredFrom, 1);
  assert.equal(restored.files["src/main.cpp"], payload.files["src/main.cpp"]);
  assert.equal(restored.approval, "restore-workspace-once");
  const replay = store.restore("owner", "project", restoreRequest);
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision, 3);
  assert.throws(
    () =>
      store.restore("owner", "project", {
        expectedRevision: 3,
        sourceRevision: 2,
        idempotencyKey: "restore-request-0002",
        approvalId,
      }),
    (error) => error.code === "approval_replayed",
  );
  assert.throws(
    () => store.snapshot("other", "project", 1),
    (error) => error.code === "workspace_revision_not_found",
  );
  store.close();
  store = createWorkspaceStore({ filename });
  const history = store.history("owner", "project");
  assert.equal(history.revisions[0].source, "restore");
  assert.equal(history.revisions[0].restoredFrom, 1);
  assert.equal(store.get("owner", "project").revision, 3);
  store.close();
});

test("workspace history retains the latest fifty immutable revisions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-workspace-retention-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") });
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  for (let revision = 0; revision < 52; revision++)
    store.put("owner", "project", {
      expectedRevision: revision,
      idempotencyKey: `retention-${String(revision).padStart(4, "0")}`,
      payload: {
        ...payload,
        files: { "src/main.cpp": `int main(){return ${revision};}` },
      },
    });
  const history = store.history("owner", "project", 0, 50);
  assert.equal(history.retention.maximumRevisions, 50);
  assert.equal(history.retention.retainedRevisions, 50);
  assert.equal(history.revisions[0].revision, 52);
  assert.equal(history.revisions.at(-1).revision, 3);
  assert.throws(
    () => store.snapshot("owner", "project", 1),
    (error) => error.code === "workspace_revision_not_found",
  );
  assert.throws(
    () =>
      store.put("owner", "project", {
        expectedRevision: 0,
        idempotencyKey: "retention-0000",
        payload: {
          ...payload,
          files: { "src/main.cpp": "int main(){return 0;}" },
        },
      }),
    (error) => error.code === "idempotency_replay_expired",
  );
  assert.equal(store.snapshot("owner", "project", 3).revision, 3);
});

test("workspace history backfills the current revision from a legacy database", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-workspace-legacy-")),
    filename = join(root, "workspaces.sqlite"),
    legacy = new DatabaseSync(filename),
    now = new Date().toISOString();
  t.after(() => rm(root, { recursive: true, force: true }));
  legacy.exec(
    "CREATE TABLE workspaces(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,project_id)); CREATE TABLE workspace_mutations(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner_id,project_id,idempotency_key));",
  );
  legacy
    .prepare(
      "INSERT INTO workspaces(owner_id,project_id,revision,payload,updated_at) VALUES(?,?,?,?,?)",
    )
    .run("owner", "project", 7, JSON.stringify(payload), now);
  legacy.close();
  const store = createWorkspaceStore({ filename }),
    history = store.history("owner", "project");
  assert.equal(history.revisions.length, 1);
  assert.equal(history.revisions[0].revision, 7);
  assert.equal(history.revisions[0].source, "legacy-backfill");
  store.close();
});
