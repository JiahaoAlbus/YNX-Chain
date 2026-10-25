import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,copyFile,readFile,writeFile,rm,symlink,readdir,realpath,chmod} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createRequire} from 'node:module';import {pathToFileURL,fileURLToPath} from 'node:url';
import {copyOriginalCloudSDK,verifyOriginalCloudSDK,addOriginalCloudSDKComponent,sealOriginalCloudSDK,verifyOriginalCloudSDKDistribution} from './package-original-cloud-sdk.mjs';
const supplier=process.env.YNX_DEVELOPER_ORIGINAL_CLOUD_SDK_ROOT||fileURLToPath(new URL('../../cloud/sdk',import.meta.url));
async function fixture(t){
 assert.ok(supplier,'Original frozen complete Cloud SDK source role required.');
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-original-cloud-role-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source'),resources=join(root,'QA.app/Contents/Resources'),code=join(resources,'code');await cp(supplier,source,{recursive:true});await mkdir(code,{recursive:true});return {root,source,resources,code};
}
test('complete original SDK is copied into the fixed loader topology, both exports resolve, provenance and SBOM retain source identity',async t=>{
 const f=await fixture(t),record=copyOriginalCloudSDK(f.source,f.code);assert.equal(record.sourceCommit,'b7c8f37504cc0f0460686302b375b8978919b7dd');assert.equal(record.files.length,6);
 const sdk=join(f.code,'apps/cloud/sdk');for(const row of record.files)assert.deepEqual(await readFile(join(sdk,row.path)),await readFile(join(f.source,row.path)));
 const require=createRequire(join(sdk,'package.json'));
 assert.equal(require.resolve('@ynx/cloud-client'),join(sdk,'index.js'));assert.equal(require.resolve('@ynx/cloud-client/observe-ide-deployment'),join(sdk,'observe-ide-deployment.mjs'));
 // Import the original dependency-free DATA/client exports only. No client,
 // Source, token callback, network request, deployment or approval is created.
 assert.equal(typeof(await import(pathToFileURL(require.resolve('@ynx/cloud-client')))).YNXCloudClient,'function');
 assert.equal(typeof(await import(pathToFileURL(require.resolve('@ynx/cloud-client/observe-ide-deployment')))).observeIDEDeployment,'function');
 const components=[];addOriginalCloudSDKComponent(components,f.resources);assert.equal(components.length,1);assert.equal(components[0].name,'@ynx/cloud-client');
 await writeFile(join(f.resources,'build-provenance.json'),JSON.stringify({sourceCommit:'a'.repeat(40)}));const sealed=sealOriginalCloudSDK(f.resources);assert.equal(sealed.SourceGranted,false);assert.equal(sealed.approvalCurrent,false);assert.equal(sealed.deploymentQualified,false);
 assert.equal(JSON.parse(await readFile(join(f.resources,'build-provenance.json'))).originalCloudSDKDistribution.sourceCommit,record.sourceCommit);
 assert.equal(verifyOriginalCloudSDKDistribution(f.resources).deploymentQualified,false);
 await writeFile(join(f.resources,'build-provenance.json'),JSON.stringify({originalCloudSDKDistribution:{...record,SourceGranted:true}}));
 assert.throws(()=>verifyOriginalCloudSDKDistribution(f.resources),/provenance differs/);
 await writeFile(join(f.resources,'build-provenance.json'),JSON.stringify({originalCloudSDKDistribution:record}));
 assert.throws(()=>copyOriginalCloudSDK(f.source,f.code),/EEXIST/);
 await writeFile(join(sdk,'index.js'),'changed');assert.throws(()=>verifyOriginalCloudSDK(f.code),/differs/);assert.throws(()=>addOriginalCloudSDKComponent([],f.resources),/differs/);
});
test('changed, extra, wrong-mode or symlinked supplier leaves cannot become packaged code',async t=>{
 for(const kind of ['changed','extra','symlink','mode']){const f=await fixture(t);if(kind==='changed')await writeFile(join(f.source,'index.js'),'changed');if(kind==='extra')await writeFile(join(f.source,'extra.js'),'extra');if(kind==='mode')await chmod(join(f.source,'index.js'),0o600);if(kind==='symlink'){await rm(join(f.source,'index.js'));await symlink(join(supplier,'index.js'),join(f.source,'index.js'));}assert.throws(()=>copyOriginalCloudSDK(f.source,f.code));assert.deepEqual(await readdir(f.code),[]);}
});
test('packaged parent symlink and arbitrary destination cannot widen the copy role',async t=>{
 const f=await fixture(t),trap=join(f.root,'trap');await mkdir(trap);await mkdir(join(f.code,'apps'));await symlink(trap,join(f.code,'apps/cloud'));assert.throws(()=>copyOriginalCloudSDK(f.source,f.code),/Regular original Cloud SDK directory/);assert.deepEqual(await readdir(trap),[]);assert.throws(()=>copyOriginalCloudSDK(f.source,f.root),/Exact packaged code root/);
});
test('actual packaged IDE loader resolves the original SDK and still refuses absent Source without any network request',async t=>{
 const f=await fixture(t);copyOriginalCloudSDK(f.source,f.code);
 const desktop=join(f.code,'apps/developer/desktop');await mkdir(desktop,{recursive:true});
 for(const name of ['artifact-publication-client.mjs','artifact-publication-lifecycle.mjs','original-publication-project.mjs','publication-result-originals.mjs'])await copyFile(fileURLToPath(new URL('../desktop/'+name,import.meta.url)),join(desktop,name));
 const {openBundledArtifactPublicationObservation}=await import(pathToFileURL(join(desktop,'artifact-publication-client.mjs')));
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=()=>{network++;throw Error('unexpected network');};
 try{await assert.rejects(openBundledArtifactPublicationObservation({}),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});assert.equal(network,0);}finally{globalThis.fetch=originalFetch;}
});


// IDE consumer integration against the verbatim six-leaf SDK and its fixed
// packaged loader. Public scope/header/HTTP fixtures are NOT live permission.
async function observedFixture(t,extra={}){
 const f=await fixture(t);copyOriginalCloudSDK(f.source,f.code);
 const desktop=join(f.code,'apps/developer/desktop');await mkdir(desktop,{recursive:true});
 for(const name of ['artifact-publication-client.mjs','artifact-publication-lifecycle.mjs','original-publication-project.mjs','publication-result-originals.mjs'])await copyFile(fileURLToPath(new URL('../desktop/'+name,import.meta.url)),join(desktop,name));
 const {openBundledArtifactPublicationObservation}=await import(pathToFileURL(join(desktop,'artifact-publication-client.mjs')));
 const profile=join(f.root,'profile');await mkdir(profile,{mode:0o700});await chmod(profile,0o700);
 const requestId='11111111-2222-4333-8444-555555555555',expected={binding:{projectId:'PUBLIC-project',version:'1',contentDigest:'a'.repeat(64),publishPurpose:'PUBLIC-purpose',targetEnvironment:'PUBLIC-env',byteSize:1},manifestSHA256:'b'.repeat(64),approvalSHA256:'c'.repeat(64),publisherId:'PUBLIC-publisher',resourceId:'PUBLIC-resource'};
 const scope={principal:{account:'PUBLIC-account',deviceId:'PUBLIC-device',sessionRef:'PUBLIC-session',currentRef:'PUBLIC-current',accountGeneration:'1',sessionGeneration:'1'},project:{projectId:'PUBLIC-project',ownerAccount:'PUBLIC-owner',currentReference:'PUBLIC-project-current',projectRevision:'1',catalogRevision:'1',read:true,publish:true,runtime:false,runtimeOrigin:''},publisher:{account:'PUBLIC-account',projectId:'PUBLIC-project',publisherId:'PUBLIC-publisher',keyRole:'ide-artifact-publisher',publicOriginal:'PUBLIC-original',publicSHA256:'PUBLIC-public-hash',registrationRef:'PUBLIC-registration',revision:'1'},expiresMS:Date.now()+60000};
 const calls=[],headers=[];let response=()=>({...expected,requestId,state:'completed',exitCode:0,logs:[]});
 const previousFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.redirect,'error');assert.equal(options.headers.get('x-public-proof'),'fixture');const logs=url.endsWith('/logs');return new Response(JSON.stringify(logs?{requestId,runtimeLogSource:'original-resource',runtimeLogs:'PUBLIC runtime output',operationLogs:[]}:response()),{status:200,headers:{'content-type':'application/json'}});};
 t.after(()=>{globalThis.fetch=previousFetch;});
 const options={context:{profile,id:requestId,workspace:f.root},publicationProject:{readObservationScope:async()=>structuredClone(scope)},endpoint:'https://PUBLIC.invalid',getDeploymentRequestHeaders:async input=>{headers.push(input);assert.equal(input.method,'GET');assert.equal(input.operationRequestId,requestId);return{'x-public-proof':'fixture'};},...extra};
 const flow=await openBundledArtifactPublicationObservation(options);t.after(()=>flow.close());await flow.retain(requestId,expected);
 return{...f,flow,options,requestId,expected,scope,calls,headers,open:openBundledArtifactPublicationObservation,setResponse:fn=>{response=fn;}};
}
test('actual packaged SDK reads status and original-resource logs with fresh proof per GET and query-only reopen',async t=>{
 const f=await observedFixture(t),result=await f.flow.resume(f.requestId);
 assert.equal(result.operation.state,'completed');assert.equal(result.logs.runtimeLogs,'PUBLIC runtime output');assert.equal(f.calls.length,2);assert.equal(f.headers.length,2);
 assert.equal(f.headers[0].path,'/api/v1/ide/deployments/'+f.requestId);assert.equal(f.headers[1].path,'/api/v1/ide/deployments/'+f.requestId+'/logs');
 f.flow.close();const reopened=await f.open(f.options);try{assert.equal((await reopened.read(f.requestId)).replayAllowed,false);await reopened.resume(f.requestId);assert.equal(f.calls.length,4);assert.equal(f.headers.length,4);}finally{reopened.close();}
});
test('actual packaged SDK cannot issue a GET after cancellation during original proof acquisition',async t=>{
 let entered,release;const started=new Promise(r=>entered=r),held=new Promise(r=>release=r);
 const f=await observedFixture(t,{getDeploymentRequestHeaders:async()=>{entered();await held;return{'x-public-proof':'fixture'};}}),controller=new AbortController(),reason=Error('PUBLIC cancelled query');
 const reading=f.flow.resume(f.requestId,{signal:controller.signal}),refused=assert.rejects(reading,e=>e===reason);await started;controller.abort(reason);await refused;release();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.length,0);assert.equal((await f.flow.read(f.requestId)).queryOnly,true);
});
test('actual packaged SDK rejects a changed deployment selection before reading logs',async t=>{
 const f=await observedFixture(t);f.setResponse(()=>({...f.expected,requestId:f.requestId,state:'completed',exitCode:0,publisherId:'PUBLIC-other-publisher'}));
 await assert.rejects(f.flow.resume(f.requestId),error=>error.operationRequestId===f.requestId&&/selection changed/.test(error.cause?.message));
 assert.equal(f.calls.length,1);assert.equal(f.headers.length,1);assert.equal((await f.flow.read(f.requestId)).replayAllowed,false);
});
test('actual packaged SDK does not automatically retry a failed GET and recovery queries only the retained ID',async t=>{
 const f=await observedFixture(t),normalFetch=globalThis.fetch;let failed=0;
 globalThis.fetch=async(url,options)=>{failed++;assert.equal(options.method,'GET');return new Response(JSON.stringify({error:'PUBLIC temporary unavailable'}),{status:503,headers:{'content-type':'application/json'}});};
 await assert.rejects(f.flow.resume(f.requestId),error=>error.operationRequestId===f.requestId);assert.equal(failed,1);assert.equal(f.calls.length,0);
 globalThis.fetch=normalFetch;await f.flow.resume(f.requestId);assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.url.includes(f.requestId)));assert.equal((await f.flow.read(f.requestId)).queryOnly,true);
});
