// Actual hosted OCI journey caller. Only the proof provider is an explicitly
// PUBLIC fixture; transport, normal Cloud service, executor and containers run.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {YNXCloudClient,YNXCloudDeploymentUnknownError} from '../sdk/index.js';
import {CloudDeploymentClient} from './deployment-client.mjs';
import {submitDeploymentReceipt,reconcileDeploymentReceipt,runDeploymentCommand} from './deployment-workflow.mjs';
let text='';for await(const chunk of process.stdin)text+=chunk;
const {base,root,stage,expectedRevision='0'}=JSON.parse(text);
const original=new YNXCloudClient({endpoint:base,product:'cloud',maxRetries:0,getDeploymentRequestHeaders:async()=>({'X-P04-CI-Identity':'PUBLIC_OWNER'})});
const client=new CloudDeploymentClient(original);
const receipt=v=>join(root,v+'.receipt.json');
const artifact=v=>Buffer.from(`import http from 'node:http';import fs from 'node:fs';import crypto from 'node:crypto';const data=JSON.stringify({version:'${v}',artifactSHA256:crypto.createHash('sha256').update(fs.readFileSync('/app/artifact.mjs')).digest('hex')});const s=http.createServer((q,r)=>{r.end(data);if(q.url==='/finish')setTimeout(()=>s.close(),150)});console.log('P04_VERSION_${v}');s.listen(18081,'127.0.0.1');`);
const manifest=body=>Buffer.from(JSON.stringify({projectId:'PUBLIC_PROJECT',version:body.equals(artifact('A'))?'A':'B',contentDigest:createHash('sha256').update(body).digest('hex'),publishPurpose:'deploy',targetEnvironment:'PUBLIC_ISOLATED_CI',byteSize:body.length}));
const input=(name,v,revision)=>({requestId:'req_recovery_'+name+'_000001',manifest:manifest(artifact(v)),artifact:artifact(v),approval:Buffer.from('PUBLIC_AUTHORED_APPROVAL:req_recovery_'+name+'_000001'),expectedSlotRevision:revision});
let output;
if(stage==='lost-A'){
 const prepared=client.prepare(input('A','A','0'));
 await writeFile(join(root,'A.artifact.mjs'),artifact('A'),{mode:0o600});
 await assert.rejects(submitDeploymentReceipt(client,prepared,receipt('A')),e=>e instanceof YNXCloudDeploymentUnknownError);
 const saved=JSON.parse(await readFile(receipt('A'),'utf8'));assert.equal(saved.state,'UNKNOWN');assert.equal('approval'in saved,false);assert.equal('artifact'in saved,false);
 output={receipt:receipt('A'),selection:saved.selection};
}else if(stage==='reconcile-A'){
 const operation=await runDeploymentCommand(client,['reconcile',receipt('A')]);
 assert.equal(operation.requestId,'req_recovery_A_000001');output=operation;
}else if(stage==='submit-B'){
 const p=client.prepare(input('B','B',expectedRevision));
 output=await submitDeploymentReceipt(client,p,receipt('B'));
}else if(stage==='rollback-A'){
 const target=JSON.parse(await readFile(receipt('A'),'utf8'));
 const fresh=input('rollback','A',expectedRevision);
 await assert.rejects(client.prepareRollback(target.selection,{...fresh,approval:Buffer.from('PUBLIC_AUTHORED_APPROVAL:req_recovery_A_000001')}),/fresh independent/);
 const changed=Buffer.from('different artifact');await assert.rejects(client.prepareRollback(target.selection,{...fresh,artifact:changed,manifest:manifest(changed)}),/Original artifact/);
 const p=await client.prepareRollback(target.selection,fresh);
 output=await submitDeploymentReceipt(client,p,receipt('rollback'));
}else if(stage==='inspect-rollback'){
 const operation=await reconcileDeploymentReceipt(client,receipt('rollback'));
 const logs=await runDeploymentCommand(client,['logs',receipt('rollback')]);assert.match(logs.runtimeLogs,/P04_VERSION_A/);
 const usage=await runDeploymentCommand(client,['usage',receipt('rollback')]);assert.equal(usage.billingState,'UNPRICED');
 const saved=JSON.parse(await readFile(receipt('rollback'),'utf8'));
 // A cold receipt always queries, even if a new prepared object is offered.
 const p=client.prepare({...input('rollback','A',expectedRevision),rollbackTo:'req_recovery_A_000001'});
 const recovered=await submitDeploymentReceipt(client,p,receipt('rollback'));assert.equal(recovered.deploymentId,operation.deploymentId);
 output={operation,logs:logs.runtimeLogs,usage,selection:saved.selection};
}else throw Error('Unknown journey stage');
process.stdout.write(JSON.stringify(output));
