import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,readFile,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {originalLinkWorkflow,readOriginalLinkFile} from '../client/link-workflow.mjs';

test('local custody crash claims preserve UNKNOWN and never replay submit/cancel or expose malformed secret',async()=>{
 // PUBLIC local-journal ports only, not Source/server admission evidence.
 const root=await mkdtemp(join(tmpdir(),'p04-cap-custody-'));await chmod(root,0o700);
 const path=join(root,'original.json'),endpoint='https://cloud.example.invalid/api/v1';let creates=0,cancels=0;
 const binding={bytes:'1',sha3_512:'a'.repeat(128),sha512:'b'.repeat(128)},expiry=new Date(Date.now()+600000).toISOString();
 const client={currentSession:async()=>({account:'PUBLIC_OWNER',product:'cloud',scopes:['permissions.manage']}),get:async()=>({version:1,revision:'1',binding}),createOriginalLink:async()=>{creates++;throw Error('must not submit');},cancelOriginalLink:async()=>{cancels++;throw Error('must not cancel');},lookupOriginal:async()=>({outcome:'UNKNOWN'})};
 await originalLinkWorkflow(client,endpoint,'prepare',path,{objectID:'obj_PUBLIC',expiresAt:expiry});
 const raw=await readFile(path,'utf8'),r=JSON.parse(raw);
 assert.match(r.token,/^share2_[A-Za-z0-9_-]{43}$/);assert.equal(raw.includes('Bearer'),false);
 const fingerprint=createHash('sha256').update(JSON.stringify({endpoint:r.endpoint,account:r.account,product:r.product,selection:r.selection})).digest('hex');
 const claim=mode=>({requestID:r.requestID,fingerprint,mode});
 // Process died after durable enter claim, before UNKNOWN publication/POST.
 await writeFile(path+'.enter',JSON.stringify(claim('SUBMIT')),{mode:0o600});
 assert.equal((await readOriginalLinkFile(path)).state,'UNKNOWN');
 await assert.rejects(originalLinkWorkflow(client,endpoint,'create',path,{objectID:'obj_PUBLIC',expiresAt:expiry}),e=>e.outcome==='UNKNOWN');assert.equal(creates,0);
 // Process died after cancellation claim, before cancel POST/response.
 await writeFile(path+'.cancel',JSON.stringify(claim('CANCEL')),{mode:0o600});
 await assert.rejects(originalLinkWorkflow(client,endpoint,'cancel',path),e=>e.outcome==='UNKNOWN');assert.equal(cancels,0);
 assert.equal(JSON.parse(await readFile(path,'utf8')).token,r.token);
 const before=await readFile(path);const other={...client,currentSession:async()=>({account:'PUBLIC_OTHER',product:'cloud',scopes:['permissions.manage']})};
 await assert.rejects(originalLinkWorkflow(other,endpoint,'reconcile',path),/another original/);assert.deepEqual(await readFile(path),before);
 const bad=join(root,'bad.json');await writeFile(bad,'{"token":"PUBLIC_SECRET_FRAGMENT" bad}',{mode:0o600});await assert.rejects(readOriginalLinkFile(bad),e=>!e.message.includes('PUBLIC_SECRET_FRAGMENT'));
 const sym=join(root,'symbolic.json');await symlink(path,sym);await assert.rejects(readOriginalLinkFile(sym));
});

test('late create response cannot overwrite a concurrently confirmed cancellation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p04-cap-late-'));await chmod(root,0o700);const path=join(root,'original.json'),endpoint='https://cloud.example.invalid/api/v1';
 const binding={bytes:'1',sha3_512:'a'.repeat(128),sha512:'b'.repeat(128)},expiry=new Date(Date.now()+600000).toISOString();
 const client={currentSession:async()=>({account:'PUBLIC_OWNER',product:'cloud',scopes:['permissions.manage']}),get:async()=>({version:1,revision:'1',binding}),createOriginalLink:async()=>{
  const r=JSON.parse(await readFile(path,'utf8'));
  const fingerprint=createHash('sha256').update(JSON.stringify({endpoint:r.endpoint,account:r.account,product:r.product,selection:r.selection})).digest('hex');
  await writeFile(path+'.cancel',JSON.stringify({requestID:r.requestID,fingerprint,mode:'CANCEL'}),{mode:0o600});
  await writeFile(path,JSON.stringify({...r,state:'REVOKED',cancelRequested:true,linkID:'link_PUBLIC'}),{mode:0o600});
  return {outcome:'COMMITTED',objectId:r.objectID,selection:r.selection,revision:'1',version:1,binding,link:{id:'link_PUBLIC',objectId:r.objectID,role:'viewer',expiresAt:expiry}};
 }};
 const result=await originalLinkWorkflow(client,endpoint,'create',path,{objectID:'obj_PUBLIC',expiresAt:expiry});
 assert.equal(result.outcome,'REVOKED');assert.equal((await readOriginalLinkFile(path)).state,'REVOKED');
});
