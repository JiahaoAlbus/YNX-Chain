import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {verifySDK49FullRuntimeTables,verifySDK49NormalSource} from '../scripts/sdk49-runtime-source.mjs';
import {issuerSourceBytes} from './fixtures/sdk49-issuer-source-fixture.mjs';
const root=fileURLToPath(new URL('../../../packages/wallet-auth',import.meta.url));
const full=()=>['original-ide-auth-runtime-manifest.json','original-ide-contract-relay-runtime-manifest.json'].map(n=>issuerSourceBytes('packages/wallet-auth/native/'+n));
test('coherent SDK49 full Auth597 and union9457 match; projected product tables cannot be used as Native full tables',()=>{
 const [auth,union]=full();assert.equal(verifySDK49FullRuntimeTables(auth,union).fullAuthSubsetOfFullUnion,true);
 for(const pair of [[issuerSourceBytes('runtime-projections/sdk49-product/original-ide-auth-runtime-manifest.json'),union],[auth,issuerSourceBytes('runtime-projections/sdk49-product/original-ide-contract-relay-runtime-manifest.json')],[Buffer.concat([auth,Buffer.from('\n')]),union]])assert.throws(()=>verifySDK49FullRuntimeTables(...pair),/WALLET_SDK49_COHERENT_SOURCE_REQUIRED/);
});
test('actual normal SDK49 daemon prefix9627 readback uses original inventory and rejects old version or altered inventory',()=>{
 const raw=fs.readFileSync(new URL('../../../runtime-projections/sdk49-full/SDK49_COMPLETE_NORMAL_PREFIX_FILE_INVENTORY.json',import.meta.url));
 const result=verifySDK49NormalSource(root,raw);assert.equal(result.normalPrefixFiles,9627);assert.equal(result.NativeAdmission,false);assert.equal(result.issuerSupplied,false);
 assert.throws(()=>verifySDK49NormalSource(root,Buffer.concat([raw,Buffer.from('\n')])),/WALLET_SDK49_COHERENT_SOURCE_REQUIRED/);
 const j=JSON.parse(raw);j.versionSDK='1.3.0-pq.3.32-auth.48';assert.throws(()=>verifySDK49NormalSource(root,Buffer.from(JSON.stringify(j))),/WALLET_SDK49_COHERENT_SOURCE_REQUIRED/);
});
