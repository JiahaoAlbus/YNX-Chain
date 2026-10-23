import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifySDK332R140Source} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url))),hash=b=>createHash('sha256').update(b).digest('hex');
const pins=[{"path": "packages/wallet-auth/src/pq-contract-deployment-transport.js", "bytes": 6043, "sha256": "63f13f64e553df2bda5fe511fe00a7e215e28ae0c10125dda451c8397d986c46"}, {"path": "packages/wallet-auth/src/pq-contract-deployment-transport.d.ts", "bytes": 1548, "sha256": "461d497f81d73fe574465f57a6727135c666135aa7b4c6d4a046f55af62809ff"}, {"path": "packages/wallet-auth/src/pq-contract-deployment-transport-node.js", "bytes": 1361, "sha256": "c03b859e88db84397c546540806b99832e223239a6a0512cb54b9181a131c622"}, {"path": "packages/wallet-auth/src/pq-contract-deployment-transport-node.d.ts", "bytes": 740, "sha256": "26ca559ff885f5270d31bbab0f32367d54dce471d122d770bc342903682b6c1e"}];
test('auth4 combined package exposes original deployment DATA codec without replacing auth3 caller',async()=>{
 const codec=await import('@ynx-chain/wallet-auth/pq-contract-deployment-transport');
 const node=await import('@ynx-chain/wallet-auth/pq-contract-deployment-transport-node');
 assert.equal(typeof node.preparePQContractDeploymentTransportData,'function');
 const raw=readFileSync(new URL('./fixtures/pq-contract-deploy-fbec-public.json',import.meta.url));assert.equal(hash(raw),'ca39d8b803a118bb468ce2806cf7654ccf120c091c0364f973e859fedeba5982');
 const f=JSON.parse(raw),files=Object.fromEntries(f.files.map(p=>[p.role,Buffer.from(p.bytes,'base64')]));
 const input={member:Buffer.from(f.nativeWire,'base64'),source:f.source,material:{artifactFile:files.artifactFile,buildInfoFile:files.buildInfoFile}};
 const packet=codec.encodePQContractDeploymentTransportData(input);assert.equal(hash(packet),'dcc3882a42e02b4c92affee5175804f22e7ca66dc90e85d203e54f4ad84b73f6');
 const captured=codec.capturePQContractDeploymentMaterialData({source:input.source,material:input.material});input.material.artifactFile.fill(0);assert.notEqual(captured.material.artifactFile[0],0);
 assert.equal(captured.compilerMaterialValidationRequired,true);assert.equal(captured.nativeAdmission,false);
});
test('auth4 retains exact frozen auth3 hierarchy and Native55 while reusing four original pure files',()=>{
 const c=JSON.parse(readFileSync(new URL('../integration/SDK332_R140_NATIVE_COMPATIBILITY.json',import.meta.url)));
 assert.equal(hash(JSON.stringify(c.NativeInputs)),'1e4bd9f08772fa741a418262f85823bdb1aca6c2054a8059bef02359980a6f07');
 assert.equal(hash(readFileSync(new URL('../src/original-auth-identity-private-joint-registration.js',import.meta.url))),'b9f7c59b42a7032a6e429b4a805aa26cb9f8267158dc2e96d2d4b8601892a2de');
 for(const p of pins){const b=readFileSync(new URL('../../../'+p.path,import.meta.url));assert.equal(b.length,p.bytes);assert.equal(hash(b),p.sha256);}
});
test('auth4 normal source selector accepts the combined frozen public exports and exact Native inputs',()=>{
 const selected=verifySDK332R140Source(root);assert.equal(selected.contract.version,'1.3.0-pq.3.32-auth.4');assert.deepEqual(selected.contract.pureDeploymentInputs,pins);
});
