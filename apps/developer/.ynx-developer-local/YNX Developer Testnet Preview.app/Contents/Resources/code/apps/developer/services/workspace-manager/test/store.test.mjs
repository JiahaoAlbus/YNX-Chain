import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceStore } from "../src/store.mjs";

const payload={name:"C++ Project",folders:["src"],files:{"src/main.cpp":"int main(){return 0;}"},open:["src/main.cpp"],active:"src/main.cpp"};
test("workspace store persists revisions, isolates owners and replays idempotently",async t=>{const root=await mkdtemp(join(tmpdir(),"ynx-workspace-store-")),filename=join(root,"workspaces.sqlite");t.after(()=>rm(root,{recursive:true,force:true}));let store=createWorkspaceStore({filename});const created=store.put("owner-a","project-a",{expectedRevision:0,idempotencyKey:"mutation-0001",payload});assert.equal(created.revision,1);assert.equal(store.get("owner-b","project-a"),null);assert.equal(store.put("owner-a","project-a",{expectedRevision:0,idempotencyKey:"mutation-0001",payload}).replayed,true);assert.throws(()=>store.put("owner-a","project-a",{expectedRevision:0,idempotencyKey:"mutation-0002",payload}),error=>error.code==="revision_conflict"&&error.currentRevision===1);store.close();store=createWorkspaceStore({filename});assert.equal(store.get("owner-a","project-a").files["src/main.cpp"],payload.files["src/main.cpp"]);store.close()});
