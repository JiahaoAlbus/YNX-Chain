import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {YNXCloudClient, YNXCloudDeploymentUnknownError} from '../sdk/index.js';

// PUBLIC transport controls: no genuine approval/signature/account or deployment.
function input() {
  const artifact = new Uint8Array(Buffer.from('actual client artifact bytes'));
  const binding = {projectId:'PUBLIC_PROJECT',version:'1',contentDigest:createHash('sha256').update(artifact).digest('hex'),publishPurpose:'deploy',targetEnvironment:'PUBLIC_TARGET',byteSize:artifact.length};
  return {requestId:'request_original_123456',artifact,manifest:JSON.stringify(binding),approval:'PUBLIC_NOT_A_SIGNATURE',binding};
}
function client(fetch) { return new YNXCloudClient({endpoint:'https://public-test.invalid',product:'cloud',getDeploymentRequestHeaders:async()=> ({'X-Public-Deployment-Source':'PUBLIC_NOT_AUTHORITY'}),fetch,maxRetries:5}); }
test('normal SDK preserves approved bytes and ordered multipart without JSON conversion',async()=>{
  const i=input();let calls=0;
  const c=client(async(url,options)=>{
    calls++;assert.equal(url,'https://public-test.invalid/api/v1/ide/deployments');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.get('Idempotency-Key'),i.requestId);assert.equal(options.headers.has('Content-Type'),false);
    assert.ok(options.body instanceof FormData);assert.deepEqual([...options.body.keys()],['manifest','approval','artifact']);assert.equal(await options.body.get('manifest').text(),i.manifest);assert.equal(await options.body.get('approval').text(),i.approval);assert.deepEqual(new Uint8Array(await options.body.get('artifact').arrayBuffer()),i.artifact);
    return Response.json({requestId:i.requestId,state:'unknown',binding:i.binding});
  });
  assert.equal((await c.submitIDEDeployment(i)).state,'unknown');assert.equal(calls,1);
});
test('timeout never retries or silently resubmits, and original status uses GET',async()=>{
  const i=input();const requests=[];
  const c=client(async(url,o)=>{requests.push({url,method:o.method});if(o.method==='POST')throw Error('PUBLIC_TIMEOUT');return Response.json(url.endsWith('/logs')?{requestId:i.requestId,operationLogs:[],runtimeLogs:'PUBLIC_NOT_REAL_RUNTIME',runtimeLogSource:'original-resource'}:{requestId:i.requestId,state:'unknown'});});
  await assert.rejects(c.submitIDEDeployment(i),e=>e instanceof YNXCloudDeploymentUnknownError&&e.operationRequestId===i.requestId&&e.state==='unknown');
  await assert.rejects(c.submitIDEDeployment(i),YNXCloudDeploymentUnknownError);assert.equal(requests.length,1);
  await c.getIDEDeploymentStatus(i.requestId);await c.getIDEDeploymentLogs(i.requestId);
  assert.deepEqual(requests.map(x=>x.method),['POST','GET','GET']);assert.ok(requests[1].url.endsWith('/'+i.requestId));assert.ok(requests[2].url.endsWith('/'+i.requestId+'/logs'));
});
test('server 503 and malformed success preserve unknown with only one submit',async()=>{
  for(const response of [()=>new Response('unavailable',{status:503}),()=>new Response('{bad',{status:200}),()=>Response.json({requestId:'different',state:'running'})]){
    let calls=0;const c=client(async()=>{calls++;return response();});await assert.rejects(c.submitIDEDeployment(input()),YNXCloudDeploymentUnknownError);assert.equal(calls,1);
  }
  const i=input();const c=client(async()=>Response.json({requestId:i.requestId,state:'running',binding:i.binding}));
  await assert.rejects(c.submitIDEDeployment(i),YNXCloudDeploymentUnknownError);
});
test('tampered artifact and header overrides never reach the transport',async()=>{
  let calls=0;const c=client(async()=>{calls++;throw Error('must not fetch');});const i=input();i.artifact[0]^=1;
  await assert.rejects(c.submitIDEDeployment(i),/approved manifest digest/);
  await assert.rejects(c.submitIDEDeployment({...input(),headers:{'Content-Type':'application/json'}}),/cannot be overridden/);
  await assert.rejects(c.submitIDEDeployment({...input(),headers:{'Idempotency-Key':'other_request_123456'}}),/cannot be overridden/);
  await assert.rejects(c.submitIDEDeployment({...input(),manifest:' '.repeat(16385)}),/byte bound/);
  assert.equal(calls,0);
});
test('concurrent duplicate original ID causes exactly one submission',async()=>{
  const i=input();let calls=0;const c=client(async()=>{calls++;return Response.json({requestId:i.requestId,state:'unknown',binding:i.binding});});
  const results=await Promise.allSettled([c.submitIDEDeployment(i),c.submitIDEDeployment(i)]);assert.equal(calls,1);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.ok(results.some(x=>x.status==='rejected'&&x.reason instanceof YNXCloudDeploymentUnknownError));
});
test('a 403 preserves operation ID and never retries',async()=>{
  const i=input();let calls=0;const c=client(async()=>{calls++;return Response.json({error:'IDE_DEPLOYMENT_APPROVAL_DENIED'},{status:403});});
  await assert.rejects(c.submitIDEDeployment(i),e=>e.status===403&&e.operationRequestId===i.requestId);assert.equal(calls,1);
});
test('status and logs refuse another request or a non-runtime log source',async()=>{
  const i=input();const wrong=client(async()=>Response.json({requestId:'another_request_123456',state:'running'}));
  await assert.rejects(wrong.getIDEDeploymentStatus(i.requestId),YNXCloudDeploymentUnknownError);
  const source=client(async()=>Response.json({requestId:i.requestId,operationLogs:[],runtimeLogs:'not real runtime',runtimeLogSource:'cloud-operation'}));
  await assert.rejects(source.getIDEDeploymentLogs(i.requestId),YNXCloudDeploymentUnknownError);
});
test('a completed bounded job requires a verified zero exit and retains the original request',async()=>{
  const i=input();const valid=client(async()=>Response.json({requestId:i.requestId,state:'completed',exitCode:0,binding:i.binding,deploymentId:'PUBLIC_JOB',runtimeUrl:'https://public-test.invalid/api/v1/ide/deployments/'+i.requestId+'/runtime'}));
  assert.equal((await valid.submitIDEDeployment(i)).state,'completed');
  const invalid=client(async()=>Response.json({requestId:i.requestId,state:'completed',exitCode:7}));
  await assert.rejects(invalid.getIDEDeploymentStatus(i.requestId),YNXCloudDeploymentUnknownError);
});
test('deployment never falls back to ordinary Wallet login or overwrites original proof headers',async()=>{
  let calls=0,tokens=0;
  const legacy=new YNXCloudClient({endpoint:'https://public-test.invalid',product:'cloud',getAccessToken:async()=>{tokens++;return 'PUBLIC_LEGACY_NOT_PUBLISH_AUTHORITY';},fetch:async()=>{calls++;throw Error('must not fetch');}});
  await assert.rejects(legacy.submitIDEDeployment(input()),/ordinary Wallet login is not a deployment grant/);assert.equal(calls,0);assert.equal(tokens,0);
  const i=input();const contexts=[];
  const original=new YNXCloudClient({endpoint:'https://public-test.invalid',product:'cloud',getDeploymentRequestHeaders:async context=>{contexts.push(context);return {'Authorization':'PUBLIC_ORIGINAL_NOT_REAL_PROOF'};},fetch:async(url,options)=>{assert.equal(options.headers.get('Authorization'),'PUBLIC_ORIGINAL_NOT_REAL_PROOF');return Response.json({requestId:i.requestId,state:'unknown',binding:i.binding});}});
  await original.submitIDEDeployment(i);assert.deepEqual(contexts,[{method:'POST',path:'/api/v1/ide/deployments',url:'https://public-test.invalid/api/v1/ide/deployments',operationRequestId:i.requestId}]);
});
