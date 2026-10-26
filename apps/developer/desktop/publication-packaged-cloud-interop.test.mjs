import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,chmod,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=process.env.YNX_IDE_NATIVE_READ_PACKAGED_CODE_ROOT;
const policy={skip:!root?'Actual normal copied code root is required; no package acceptance claimed':false};
const requestId='11111111-2222-4333-8444-555555555555';
const observationId='22222222-3333-4444-8555-666666666666';
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
async function fixture(t,{deny,pendingProof=false}={}){
 const load=rel=>import(pathToFileURL(join(root,rel)).href);
 const {verifyOriginalCloudSDK}=await load('apps/developer/scripts/package-original-cloud-sdk.mjs');
 const provenance=verifyOriginalCloudSDK(root);assert.equal(provenance.SourceGranted,false);
 const [{YNXCloudClient},{observeIDEDeployment},{openPublicationObservation},{capturePublicationReadOwner},{createArtifactPublicationHost}]=await Promise.all([
  load('apps/cloud/sdk/index.js'),load('apps/cloud/sdk/observe-ide-deployment.mjs'),
  load('apps/developer/desktop/artifact-publication-lifecycle.mjs'),load('apps/developer/desktop/publication-native-read-owner.mjs'),load('apps/developer/desktop/artifact-publication-host.mjs')]);
 const profile=await realpath(await mkdtemp(join(tmpdir(),'ynx-public-cloud-interop-')));await chmod(profile,0o700);t.after(()=>rm(profile,{recursive:true,force:true}));
 const context={id:observationId,profile,workspace:profile};
 const principal={account:'PUBLIC-account',deviceId:'PUBLIC-device',sessionRef:'PUBLIC-session',currentRef:'PUBLIC-current',accountGeneration:'1',sessionGeneration:'2'};
 const project={projectId:'PUBLIC-project',ownerAccount:'PUBLIC-owner',currentReference:'PUBLIC-project-current',projectRevision:'1',catalogRevision:'1',read:true,publish:false,runtime:false,runtimeOrigin:'https://public.invalid'};
 const publisher={account:principal.account,projectId:project.projectId,publisherId:'PUBLIC-publisher',keyRole:'ide-artifact-publisher',publicOriginal:'PUBLIC-original',publicSHA256:'a'.repeat(64),registrationRef:'PUBLIC-registration',revision:'1'};
 const serviceRegistration={apiEndpoint:'https://public.invalid/api/v1',tlsSPKISHA256:'a'.repeat(64),scopes:['account:read']};
 const source={principal,project,serviceRegistration,expiresMS:Date.now()+60000};
 const expected={binding:{projectId:project.projectId,version:'PUBLIC-v1',contentDigest:'b'.repeat(64),publishPurpose:'PUBLIC-test',targetEnvironment:'testnet',byteSize:1},manifestSHA256:'c'.repeat(64),approvalSHA256:'d'.repeat(64),publisherId:publisher.publisherId,resourceId:'PUBLIC-resource'};
 const scope={principal,project,publisher,expiresMS:source.expiresMS};
 const calls={http:[],proof:0,network:[],closed:[]},entered=deferred(),released=deferred();let first=true,proofFlight,proofDrained=false;
 function owner(){
  const originalProject={readObservationServiceRegistration:async()=>source,readObservationScope:async()=>scope,close(){calls.closed.push('project');}};
  const ports={context:async()=>({requestId,source,device:{id:principal.deviceId,key:'PUBLIC-key',scopes:['account:read']}}),authorizeNetwork:async url=>{calls.network.push(url);if(deny!==undefined)throw deny;},close(){if(pendingProof)assert.equal(proofDrained,true,'original proof drain precedes protected port cleanup');calls.closed.push('ports');}};
  return capturePublicationReadOwner({context,control:{open:()=>ports},openProject:async()=>originalProject,load:async()=>({registry:{PUBLIC:true},CloudClient:YNXCloudClient,observeIDEDeployment,
   createReadClient:async()=>({capabilities:{kind:'existing-native-business-read',identityGrant:false,nativeAdmission:false,connected:false,newSession:false},async createBusinessProof(){calls.proof++;if(pendingProof){entered.resolve();await(proofFlight=released.promise.then(()=>{proofDrained=true;throw Error('PUBLIC proof was retired');}));}return{proofHeader:'PUBLIC-no-signature-no-admission'};},async close(){calls.closed.push('client');released.resolve();await proofFlight?.catch(()=>{});}}),
   createFetch:({assertCurrent,assertNetworkApproved})=>async(url,options)=>{await assertCurrent();await assertNetworkApproved(url);assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(new Headers(options.headers).get('authorization'),null);assert.equal(new Headers(options.headers).get('x-ynx-product-session-proof-v2'),'PUBLIC-no-signature-no-admission');calls.http.push(url);
    const result=url.endsWith('/logs')?{requestId,runtimeLogSource:'original-resource',runtimeLogs:'PUBLIC Hello World',operationLogs:[]}:{requestId,state:'completed',exitCode:0,...expected};
    return new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});},
   openObservation:async options=>{const observer=await openPublicationObservation(options);if(first){first=false;await observer.retain(requestId,expected);}return observer;}
  })});
 }
 const host=createArtifactPublicationHost({context,openObservation:()=>owner()});t.after(()=>host.close());
 return{host,calls,profile,entered,released};
}
test('normal copied IDE and original Cloud SDK read saved status/logs and reopen the same journal',policy,async t=>{
 const f=await fixture(t),first=await f.host.observe(requestId);
 assert.equal(first.operation.state,'completed');assert.equal(first.logs.runtimeLogs,'PUBLIC Hello World');
 const journal=join(f.profile,'artifact-publication-queries',requestId+'.json'),before=await readFile(journal,'utf8');
 const second=await f.host.observe(requestId);assert.deepEqual(second,first);assert.equal(await readFile(journal,'utf8'),before);
 assert.equal(f.calls.proof,4);assert.equal(f.calls.http.length,4);assert.equal(f.calls.network.filter(url=>url==='https://wallet-auth.ynxweb4.com/v2/product-sessions/time').length,4);
 assert.deepEqual(f.calls.closed,['client','ports','project','client','ports','project']);
});
test('original permission refusal prevents Cloud HTTP and proof generation in the copied normal graph',policy,async t=>{
 const denied=Error('PUBLIC denied'),f=await fixture(t,{deny:denied});await assert.rejects(f.host.observe(requestId),error=>error.cause===denied||error===denied);
 assert.equal(f.calls.proof,0);assert.equal(f.calls.http.length,0);assert.deepEqual(f.calls.closed,['client','ports','project']);
});
test('normal host cancellation retires a held proof and the real Cloud client cannot start a late GET',policy,async t=>{
 const f=await fixture(t,{pendingProof:true}),reading=f.host.observe(requestId,{observationId});
 const rejected=assert.rejects(reading,{code:'IDE_PUBLICATION_OBSERVATION_CANCELLED'});await f.entered.promise;
 assert.equal((await f.host.cancelObservation(observationId)).cancelled,true);await rejected;await f.host.close();
 assert.equal(f.calls.proof,1);assert.equal(f.calls.http.length,0);assert.deepEqual(f.calls.closed,['client','ports','project']);
});
