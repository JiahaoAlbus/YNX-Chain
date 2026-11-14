import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWorkspaceFileSave,resumeWorkspaceFileSave} from '../frontend/src/runtime/fileSave.ts';
const input={projectId:'project-A',expectedRevision:1,path:'源码/你好.js',contents:'console.log("hello")',idempotencyKey:'original-file-save-001'};
const hash=createHash('sha256').update(JSON.stringify({domain:'YNX_WORKSPACE_FILE_SAVE_V1',expectedRevision:input.expectedRevision,path:input.path,contents:input.contents})).digest('hex');
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
test('lost original save response and caller restart only query its receipt and exact snapshot',async()=>{
 const calls=[];const request=async(url,options)=>{calls.push([url,options.method||'GET']);if(options.method==='PATCH')throw Error('lost response');if(url.includes('view=mutation'))return json({receipt:{revision:2,requestHash:hash}});return json({workspace:{revision:2,files:{[input.path]:input.contents}}});};
 const operation=createWorkspaceFileSave(input,{request});assert.equal((await operation.submit()).state,'unknown');
 const resumed=resumeWorkspaceFileSave(JSON.parse(JSON.stringify(operation.serialize())),{request});assert.equal((await resumed.submit()).state,'saved');
 assert.deepEqual(calls.map(call=>call[1]),['PATCH','GET','GET']);assert.ok(calls[1][0].includes(input.idempotencyKey));
});
test('missing/mismatched receipt remains UNKNOWN without repeating write or adopting unrelated contents',async()=>{
 let patches=0;const request=async(url,options)=>{if(options.method==='PATCH'){patches++;throw Error('unknown');}return json({receipt:{revision:2,requestHash:'a'.repeat(64)}});};
 const operation=createWorkspaceFileSave(input,{request});await operation.submit();assert.equal((await operation.submit()).code,'save_receipt_mismatch');assert.equal(patches,1);
});
test('concurrent submits share one immutable request and invalid path/revision is rejected locally',async()=>{
 let writes=0,release;const wait=new Promise(resolve=>{release=resolve;});
 const mutable={...input};const operation=createWorkspaceFileSave(mutable,{request:async(_url,options)=>{writes++;await wait;assert.equal(JSON.parse(options.body).contents,input.contents);return json({workspace:{revision:2,files:{[input.path]:input.contents}}});}});
 mutable.contents='replaced';const first=operation.submit(),second=operation.submit();release();assert.deepEqual(await first,await second);assert.equal(writes,1);
 assert.throws(()=>createWorkspaceFileSave({...input,path:'../escape'}));assert.throws(()=>createWorkspaceFileSave({...input,expectedRevision:NaN}));
});
