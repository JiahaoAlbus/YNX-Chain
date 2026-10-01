import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createCodeOSSService } from "../src/service.mjs";

const owner = "a".repeat(64), project = "crash-project";
const snapshot = { name: "Crash recovery", files: { "main.js": "console.log(42)" }, folders: [], open: ["main.js"], active: "main.js" };
const storeImport = new URL("../../workspace-manager/src/store.mjs", import.meta.url).href, coreImport = new URL("../src/service.mjs", import.meta.url).href;
test("real SIGKILL before admission commit rolls back writer; after commit cold Stop retains exact recovery", async () => {
  for (const stage of ["writer-insert", "committed-before-execution"]) {
    const root = await mkdtemp(join(tmpdir(), "ynx-core-crash-")), filename = join(root, "workspace.sqlite");
    let store = createWorkspaceStore({ filename }); store.put(owner, project, { expectedRevision: 0, idempotencyKey: "seed-crash-recovery", payload: snapshot }); store.close();
    const script = `import {createWorkspaceStore} from ${JSON.stringify(storeImport)}; import {createCodeOSSService} from ${JSON.stringify(coreImport)}; import {createServer} from 'node:http';
      const store=createWorkspaceStore({filename:${JSON.stringify(filename)}});
      ${stage === "writer-insert" ? "const claim=store.claimWriterInTransaction;store.claimWriterInTransaction=(...args)=>{claim(...args);process.kill(process.pid,'SIGKILL')};" : ""}
      const core=createCodeOSSService({filename:${JSON.stringify(join(root, "unused-legacy.sqlite"))},root:${JSON.stringify(join(root, "native"))},workspaceStore:store,
        verifyIdentity:async()=>({owner:${JSON.stringify(owner)},workspaceOwner:${JSON.stringify(owner)},account:'ynx-a',generation:1,expiresAt:Date.now()+3600000}),
        launchURL:({sessionId})=>'https://'+sessionId+'.ynx-native.dev/',assertProjectQuiescent(){},driver:{async start(){process.kill(process.pid,'SIGKILL')}}});
      const server=createServer((req,res)=>core.handler(req,res));server.listen(0,'127.0.0.1',async()=>{await fetch('http://127.0.0.1:'+server.address().port+'/runtime/codeoss',{method:'POST',body:JSON.stringify({projectId:${JSON.stringify(project)},expectedRevision:1,approval:'launch-native-ide-once'})});process.exit(7)});`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { timeout: 10000, stdio: "pipe" }); assert.equal(child.signal, "SIGKILL", child.stderr.toString());
    store = createWorkspaceStore({ filename }); const db = store.nativeJournalDatabase();
    const expected = stage === "writer-insert" ? 0 : 1;
    assert.equal(db.prepare("SELECT COUNT(*) n FROM workspace_writers").get().n, expected);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM codeoss_sessions").get().n, expected);
    if (!expected) store.assertWritable(owner, project);
    else {
      const row = db.prepare("SELECT * FROM codeoss_sessions").get(); assert.equal(row.project, project); assert.equal(row.workspace_owner, owner);
      const core = createCodeOSSService({ filename: join(root, "unused-legacy.sqlite"), root: join(root, "native"), workspaceStore: store,
        verifyIdentity: async () => ({ owner, workspaceOwner: owner, account: "ynx-a", generation: 1, expiresAt: Date.now() + 3600000 }),
        driver: { stop: async context => ({ stopped: true, neverStarted: true, runtimeId: context.runtimeId, identityDigest: context.identityDigest }) } });
      const server = createServer((req, res) => core.handler(req, res)); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const stopped = await fetch(`http://127.0.0.1:${server.address().port}/runtime/codeoss/${row.id}`, { method: "DELETE" }); assert.equal(stopped.status, 200);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM workspace_writers").get().n, 0); store.assertWritable(owner, project);
      await new Promise(resolve => server.close(resolve)); core.close();
    }
    store.close();
  }
});
test("another live broker process cannot launch or Stop in the same journal", async () => {
  const root = await mkdtemp(join(tmpdir(), "ynx-core-owner-")), filename = join(root, "workspace.sqlite"), store = createWorkspaceStore({ filename });
  const options = { filename: join(root, "unused.sqlite"), root: join(root, "native"), workspaceStore: store }, core = createCodeOSSService(options);
  const script = `import {createWorkspaceStore} from ${JSON.stringify(storeImport)};import {createCodeOSSService} from ${JSON.stringify(coreImport)};try{createCodeOSSService({filename:${JSON.stringify(options.filename)},root:${JSON.stringify(options.root)},workspaceStore:createWorkspaceStore({filename:${JSON.stringify(filename)}})});process.exit(8)}catch(e){process.exit(e.message.includes('Another live native IDE broker')?0:9)}`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { timeout: 10000 }); assert.equal(child.status, 0, child.stderr?.toString());
  core.close(); store.close();
});
