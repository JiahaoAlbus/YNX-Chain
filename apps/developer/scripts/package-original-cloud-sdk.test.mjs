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
 for(const name of ['artifact-publication-client.mjs','artifact-publication-lifecycle.mjs'])await copyFile(fileURLToPath(new URL('../desktop/'+name,import.meta.url)),join(desktop,name));
 const {openBundledArtifactPublicationObservation}=await import(pathToFileURL(join(desktop,'artifact-publication-client.mjs')));
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=()=>{network++;throw Error('unexpected network');};
 try{await assert.rejects(openBundledArtifactPublicationObservation({}),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});assert.equal(network,0);}finally{globalThis.fetch=originalFetch;}
});
