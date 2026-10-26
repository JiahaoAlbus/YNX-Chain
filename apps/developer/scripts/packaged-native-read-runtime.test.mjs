import test from 'node:test';import assert from 'node:assert/strict';
import {lstat,realpath,readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const root=process.env.YNX_IDE_NATIVE_READ_PACKAGED_CODE_ROOT;
test('normal copied runtime contains the complete native read import graph and original Cloud verifier',{
 skip:!root?'Actual normal copied code root not supplied; packaged runtime acceptance not claimed':false
},async()=>{
 assert.equal(resolve(root),root);assert.ok(root.endsWith('/Contents/Resources/code'));assert.equal(await realpath(root),root);
 const leaves=['desktop/native-service-read-control.mjs','desktop/publication-native-read-owner.mjs','desktop/publication-pinned-read-fetch.mjs','scripts/package-original-cloud-sdk.mjs','scripts/original-cloud-sdk-inputs.json'];
 for(const leaf of leaves){const st=await lstat(join(root,'apps/developer',leaf));assert.ok(st.isFile()&&!st.isSymbolicLink(),leaf);}
 const load=path=>import(pathToFileURL(join(root,'apps/developer',path)));
 const [control,owner,fetch,cloud]=await Promise.all([load(leaves[0]),load(leaves[1]),load(leaves[2]),load(leaves[3])]);
 assert.equal(typeof control.createNativeServiceReadControl,'function');assert.equal(typeof owner.openBundledPublicationReadOwner,'function');assert.equal(typeof fetch.createPinnedServiceReadFetch,'function');
 const record=cloud.verifyOriginalCloudSDK(root);assert.equal(record.sourceOnly,true);assert.equal(record.SourceGranted,false);assert.equal(record.approvalCurrent,false);assert.equal(record.deploymentQualified,false);
 // This verifies package contents/imports, never runs the server or opens an API.
 const entry=await readFile(join(root,'apps/developer/desktop/code-server.mjs'),'utf8').catch(error=>{if(error.code==='ENOENT')return readFile(join(root,'..','server.mjs'),'utf8');throw error;});
 assert.match(entry,/openObservation:currentContext=>openBundledPublicationReadOwner/);
});
