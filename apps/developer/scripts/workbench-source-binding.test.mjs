import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {composedTreeDigest} from '../services/codeoss-service/src/composed-runtime.mjs';
import {verifyOwnedWorkbenchBinding} from './workbench-source-binding.mjs';
test('old or changed core cannot silently omit current project-service source',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ynx-source-binding-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(join(dir,'project-services-channel.js'),'PUBLIC source 1');
 const digest=await composedTreeDigest(dir);await assert.rejects(verifyOwnedWorkbenchBinding({},dir),{code:'YNX_COMPOSED_WORKBENCH_SOURCE_MISMATCH'});
 assert.equal(await verifyOwnedWorkbenchBinding({workbenchSourceTreeSha256:digest},dir),digest);
 await writeFile(join(dir,'project-services-channel.js'),'PUBLIC source 2');await assert.rejects(verifyOwnedWorkbenchBinding({workbenchSourceTreeSha256:digest},dir),{code:'YNX_COMPOSED_WORKBENCH_SOURCE_MISMATCH'});
});
